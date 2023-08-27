import type { RenderContext } from "@storybook/types";
import win from "./globals";

import type { MarkoRenderer } from "./types";

const document = win.document as Document;
const rootEl = document.getElementById("root")!;
const activeSubscriptions: Record<string, (...args: unknown[]) => void> = {};
let activeComponent: any = null; // the current mounted component instance.
let activeTemplate: any = null; // template for the currently loaded component.
let activeStoryId: string | null = null; // used to determine if we've switched stories.

export const render = (input: any) => ({ input });

export function renderToCanvas(ctx: RenderContext<MarkoRenderer>) {
  const config = ctx.storyFn();
  const component = config?.component || ctx.storyContext.component;

  if (!component) {
    ctx.showError({
      title: `Expecting an object with a component property to be returned from the story: "${ctx.name}" of "${ctx.kind}".`,
      description: `\
        Did you forget to return the component from the story or specify a component in the default export?\
        Use "() => ({ component: MyComponent, input: { hello: 'world' } })" when defining the story.\
      `,
    });

    return;
  }

  const input: Record<string, unknown> = {};
  const subscriptions: typeof activeSubscriptions = {};

  for (const key in config.input) {
    const val = config.input[key];
    const eventName = typeof val === "function" && toEventName(key);

    if (eventName) {
      subscriptions[eventName] = val;
    } else {
      input[key] = val;
    }
  }

  if (
    activeStoryId === ctx.id &&
    activeTemplate === component &&
    activeComponent.state
  ) {
    activeComponent.input = input;
    activeComponent.update();

    for (const eventName in activeSubscriptions) {
      const fn = activeSubscriptions[eventName];
      if (subscriptions[eventName] !== fn) {
        delete activeSubscriptions[eventName];
        activeComponent.removeListener(eventName, fn);
      }
    }

    for (const eventName in subscriptions) {
      const fn = subscriptions[eventName];
      if (activeSubscriptions[eventName] !== fn) {
        activeSubscriptions[eventName] = fn;
        activeComponent.on(eventName, fn);
      }
    }
  } else {
    if (activeComponent) {
      for (const eventName in activeSubscriptions) {
        delete activeSubscriptions[eventName];
      }

      activeComponent.destroy();
    }

    activeStoryId = ctx.id;
    activeTemplate = component;
    activeComponent = component
      .renderSync(input)
      .replaceChildrenOf(rootEl)
      .getComponent();

    for (const eventName in subscriptions) {
      activeComponent.on(
        eventName,
        (activeSubscriptions[eventName] = subscriptions[eventName])
      );
    }
  }

  ctx.showMain();
}

function toEventName(method: string) {
  const match = /^on(-)?(.*)$/.exec(method);
  if (match) {
    const [, isDash, eventName] = match;
    return isDash
      ? eventName
      : eventName.charAt(0).toLowerCase() + eventName.slice(1);
  }

  return false;
}
