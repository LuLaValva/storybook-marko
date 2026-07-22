import type { MarkoStoryResult } from "./types";

/** Content minted by one of content-shell.marko's `<define>` slots. */
export interface ContentSlot {
  /** Where in the component's input the minted content is placed. */
  path: string[];
  /** String content rendered escaped. */
  text?: string;
  /** String content rendered as raw HTML. */
  html?: string;
  /** A template rendered as the content (used for decorator children). */
  child?: Marko.Template;
  childInput?: Record<string, unknown>;
}

export const MAX_CONTENT_SLOTS = 4;

let contentShell: Marko.Template | undefined;

/**
 * Registers the compiled template used to wrap Tags API stories that build
 * body content from args. Registered automatically by the preview entry
 * (where the builder compiles `.marko` files); test environments that render
 * composed stories with body content args or decorators must register it
 * manually:
 *
 * ```ts
 * import { setContentShell } from "@storybook/marko";
 * import contentShell from "@storybook/marko/content-shell.marko";
 * setContentShell(contentShell);
 * ```
 */
export function setContentShell(template: Marko.Template) {
  contentShell = template;
}

/**
 * Mounts content-shell.marko around the component. Each slot becomes real
 * compiled content via one of the shell's `<define>`s, and `assemble` places
 * it at the slot's path in the component's input.
 */
export function wrapWithContentShell(
  why: string,
  component: Marko.Template,
  componentInput: Record<string, unknown> | undefined,
  slots: ContentSlot[],
): Required<MarkoStoryResult> {
  if (!contentShell) {
    throw new Error(
      `@storybook/marko: ${why} requires the content shell template, which was not registered. ` +
        `In Storybook this happens automatically as long as your builder compiles ".marko" files ` +
        `from within @storybook/marko. In other environments (e.g. rendering composed stories in ` +
        `tests), register it manually with setContentShell().`,
    );
  }
  if (slots.length > MAX_CONTENT_SLOTS) {
    throw new Error(
      `@storybook/marko: ${why} supports at most ${MAX_CONTENT_SLOTS} content args per story.`,
    );
  }
  return {
    component: contentShell,
    input: {
      component,
      contents: slots,
      assemble: (contents: { content: unknown }[]) =>
        slots.reduce(
          (input, slot, i) => setAtPath(input, slot.path, contents[i].content),
          { ...componentInput },
        ),
    },
  };
}

function setAtPath(
  root: Record<string, unknown>,
  path: string[],
  value: unknown,
) {
  let obj = root;
  for (let i = 0; i < path.length - 1; i++) {
    // Spreading preserves attr tag objects: their iterator is an own
    // enumerable symbol property.
    obj = obj[path[i]] = { ...(obj[path[i]] as Record<string, unknown>) };
  }
  obj[path[path.length - 1]] = value;
  return root;
}
