import { DecoratorFunction, LegacyStoryFn } from "@storybook/types";
import { MarkoRenderer, StoryContext } from "./public-types";

export function applyDecorators(storyFn: any, decorators: any[]) {
  return decorators.reduce(
    (
        decoratedStoryFn: LegacyStoryFn<MarkoRenderer>,
        decorator: DecoratorFunction<MarkoRenderer>
      ) =>
      (context: StoryContext) => {
        return decorator(() => decoratedStoryFn(context), context);
      },
    (context: StoryContext) => storyFn(context)
  );
}
