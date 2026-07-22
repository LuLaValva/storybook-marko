import { UPDATE_STORY_ARGS } from "storybook/internal/core-events";
import type {
  Args,
  ArgsStoryFn,
  RenderContext,
  StoryContext,
  StrictArgTypes,
} from "storybook/internal/types";
import { addons } from "storybook/preview-api";

import { attrTag } from "./attr-tag";
import { type ContentSlot, wrapWithContentShell } from "./content-shell";
import type { MarkoRenderer, MarkoStoryResult } from "./types";

type Subscriptions = Record<string, (...args: unknown[]) => void>;
interface CanvasState {
  instance: Marko.Component;
  template: Marko.Template;
}
const stateByCanvasElement = new WeakMap<
  MarkoRenderer["canvasElement"],
  CanvasState
>();
const subscriptionsByInstance = new WeakMap<Marko.Component, Subscriptions>();
const processedResults = new WeakSet<MarkoStoryResult>();

export function renderToCanvas(
  ctx: RenderContext<MarkoRenderer>,
  canvasElement: MarkoRenderer["canvasElement"],
) {
  const config = ctx.storyFn();
  let template = config?.component || ctx.storyContext.component;
  const state = stateByCanvasElement.get(canvasElement);
  let instance = state?.instance;
  assertHasTemplate(template, ctx);

  if (isTagsAPI(template)) {
    let input = config.input || {};
    if (!processedResults.has(config)) {
      input = processInput(input, ctx.storyContext, true);
      ({ component: template, input } = wrapBodyContent(
        template,
        input,
        ctx.storyContext,
      ));
    }

    if (instance && (ctx.forceRemount || state!.template !== template)) {
      instance = undefined;
      cleanup(canvasElement);
    }

    if (instance) {
      (instance as any as Marko.MountedTemplate).update(input);
    } else {
      instance = template.mount(input, canvasElement) as any;
    }
  } else {
    if (
      instance &&
      (ctx.forceRemount || !instance.state || state!.template !== template)
    ) {
      instance = undefined;
      cleanup(canvasElement);
    }

    const input: Record<string, unknown> = {};
    const subscriptions: Subscriptions = {};

    for (const key in config.input) {
      const val = config.input[key];
      const eventName = typeof val === "function" && toEventName(key);

      if (eventName) {
        subscriptions[eventName] = val;
      } else {
        input[key] = val;
      }
    }
    if (instance) {
      const activeSubscriptions = subscriptionsByInstance.get(instance)!;
      (instance as any).input = input;
      instance.update();

      for (const eventName in activeSubscriptions) {
        const fn = activeSubscriptions[eventName];
        if (subscriptions[eventName] !== fn) {
          delete activeSubscriptions[eventName];
          instance.removeListener(eventName, fn);
        }
      }

      for (const eventName in subscriptions) {
        const fn = subscriptions[eventName];
        if (activeSubscriptions[eventName] !== fn) {
          activeSubscriptions[eventName] = fn;
          instance.on(eventName, fn);
        }
      }
    } else {
      instance = template
        .renderSync(
          processedResults.has(config)
            ? input
            : processInput(input, ctx.storyContext, false),
        )
        .replaceChildrenOf(canvasElement)
        .getComponent();

      for (const eventName in subscriptions) {
        instance.on(eventName, subscriptions[eventName]);
      }
    }

    subscriptionsByInstance.set(instance, subscriptions);
  }

  stateByCanvasElement.set(canvasElement, { instance: instance!, template });
  ctx.showMain();

  return () => cleanup(canvasElement);
}

export const render: ArgsStoryFn<MarkoRenderer> = (args, ctx) => {
  const { component } = ctx;
  assertHasTemplate(component, ctx);

  return markProcessed(
    wrapBodyContent(
      component,
      processInput(args, ctx, isTagsAPI(component)),
      ctx,
    ),
  );
};

/**
 * Marks a story result as fully processed so `renderToCanvas` mounts it
 * as-is instead of running `processInput`/`wrapBodyContent` again.
 */
export function markProcessed<T extends MarkoStoryResult>(result: T): T {
  processedResults.add(result);
  return result;
}

/**
 * Tags API templates receive string `bodyContent` args by mounting the
 * content shell around the story component, which turns each string into
 * real compiled body content placed at the arg's path in the input (see
 * content-shell.marko).
 */
export function wrapBodyContent(
  component: Marko.Template,
  input: Marko.TemplateInput<Args>,
  ctx: Pick<StoryContext, "argTypes">,
): Required<MarkoStoryResult> {
  if (!isTagsAPI(component)) return { component, input };

  const slots: ContentSlot[] = [];
  collectContentSlots(ctx.argTypes, input, [], slots);
  if (!slots.length) return { component, input };

  return wrapWithContentShell(
    "Passing body content args",
    component,
    input,
    slots,
  );
}

function collectContentSlots(
  argTypes: StrictArgTypes,
  input: Marko.TemplateInput<Args>,
  basePath: string[],
  slots: ContentSlot[],
) {
  for (const key in argTypes) {
    const argType = argTypes[key];
    if (!argType) continue;

    const path = [...basePath, ...argPath(key, !!argType["@"])];
    if (argType.bodyContent) {
      const value = getAtPath(input, path);
      if (typeof value === "string") {
        slots.push({
          path,
          html: argType.bodyContent === "html" ? value : undefined,
          text: argType.bodyContent === "html" ? undefined : value,
        });
      }
    }

    // Nested attr tag argTypes (`"@"`) are visited only in their unflattened
    // form; flattened `@foo > bar` keys already appear at the top level.
    if (argType["@"] && !key.startsWith("@")) {
      collectContentSlots(
        argType["@"] as StrictArgTypes,
        input,
        path.slice(0, -1),
        slots,
      );
    }
  }
}

/**
 * Maps an arg key to its input path: `@foo > @bar > baz` becomes
 * ["foo", "bar", "baz"], and a key naming an attr tag itself maps to that
 * tag's `content`.
 */
function argPath(key: string, isAttrTag: boolean) {
  const path = [];
  while (key.startsWith("@")) {
    const i = key.indexOf(" > ");
    if (i === -1) return [...path, key.substring(1), "content"];
    path.push(key.substring(1, i));
    key = key.substring(i + 3);
  }
  path.push(key);
  if (isAttrTag) path.push("content");
  return path;
}

function getAtPath(obj: unknown, path: string[]) {
  for (const key of path) obj = (obj as Args | undefined)?.[key];
  return obj;
}

function isTagsAPI(template: Marko.Template) {
  return !template.renderSync;
}

function assertHasTemplate(
  template: any,
  ctx: { title: string; name: string },
): asserts template is Marko.Template {
  if (!template || !(template.mount || template.renderSync)) {
    throw new Error(
      `Expected a component to be specified in the story: "${ctx.title} > ${ctx.name}".`,
    );
  }
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

function cleanup(canvasElement: MarkoRenderer["canvasElement"]) {
  const state = stateByCanvasElement.get(canvasElement);
  if (!state) return;

  state.instance.destroy();
  canvasElement.innerHTML = "";
  stateByCanvasElement.delete(canvasElement);
  subscriptionsByInstance.delete(state.instance);
}

/**
 * Un-flatten attr tags and add change handlers
 */
function processInput(args: Args, ctx: StoryContext, tagsApi: boolean) {
  const input = {} as typeof args;

  for (const key in args) {
    let path = key;
    let obj = input;
    // Attr tag nested attributes have been converted to `@foo > @bar > baz` by `entry-preview.ts`
    while (path.startsWith("@")) {
      const i = path.indexOf(" > ");
      obj = obj[path.substring(1, i)] ??= attrTag({});
      path = path.substring(i + 3);
    }

    // Body content strings become render-body functions for the class API;
    // the Tags API turns them into content via the shell in wrapBodyContent.
    const type = ctx.argTypes[key]?.bodyContent;
    const val = args[key];
    if (type && !tagsApi && typeof val === "string") {
      obj[path] =
        type === "html"
          ? (out: any) => out.html(val)
          : (out: any) => out.text(val);
    } else {
      obj[path] = val;
    }

    // Add controllable change handlers
    if (ctx.argTypes[key]?.controllable && !args[key + "Change"]) {
      obj[path + "Change"] = (v: unknown) => {
        addons.getChannel().emit(UPDATE_STORY_ARGS, {
          storyId: ctx.id,
          updatedArgs: { [key]: v },
        });
      };
    }
  }

  return input;
}
