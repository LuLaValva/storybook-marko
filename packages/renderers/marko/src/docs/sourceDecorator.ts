import { StoryContext } from "@storybook/types";

export const sourceDecorator = (storyFn: any, context: StoryContext) => {
  // TODO: This is completely written by copilot as a placeholder
  const story = storyFn();
  const { source } = story;
  return {
    ...story,
    source: typeof source === "string" ? source : source.toString(),
  };
};
