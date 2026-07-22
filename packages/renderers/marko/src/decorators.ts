import type {
  Args,
  DecoratorApplicator,
  StoryContext,
} from "storybook/internal/types";
import { sanitizeStoryContextUpdate } from "storybook/preview-api";

import { wrapWithContentShell } from "./content-shell";
import { markProcessed } from "./render";
import type { MarkoRenderer, MarkoStoryResult } from "./types";

export const applyDecorators: DecoratorApplicator<MarkoRenderer, Args> = (
  storyFn,
  decorators,
) =>
  decorators.reduce(
    (decorated, decorator) =>
      (context: StoryContext<MarkoRenderer>): MarkoStoryResult => {
        let story: MarkoStoryResult | undefined;
        const decoratedStory: MarkoStoryResult = decorator((update) => {
          story = decorated({
            ...context,
            ...sanitizeStoryContextUpdate(update),
          });
          return story;
        }, context);

        story ||= decorated(context);

        if (decoratedStory === story) return story;

        const component = decoratedStory.component || context.component;
        if (component && !component.renderSync) {
          // Tags API: the shell renders the decorator with the inner story as
          // its body content (see content-shell.marko).
          return markProcessed(
            wrapWithContentShell(
              "Decorating a Tags API template",
              component,
              decoratedStory.input,
              [
                {
                  path: ["content"],
                  child: story?.component,
                  childInput: story?.input,
                },
              ],
            ),
          );
        }
        return {
          component,
          input: {
            ...decoratedStory.input,
            renderBody(out: Marko.Out) {
              story?.component?.render(story.input || {}, out);
            },
          },
        };
      },
    (context: StoryContext<MarkoRenderer>): MarkoStoryResult =>
      storyFn(context),
  );
