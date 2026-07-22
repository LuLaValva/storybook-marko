import type { Meta, Story } from "@storybook/marko";

import Border from "./border.marko";
import TagsContent, { type Input } from "./index.marko";

// Controls edit body content as strings; the renderer turns them into content.
type StoryInput = Omit<Input, "content" | "header"> & {
  content?: string;
  header?: { title?: string; content?: string };
};

export default {
  title: "TagsContent",
  component: TagsContent,
  argTypes: {
    name: {
      type: "string",
      control: "text",
    },
    content: {
      control: "text",
      bodyContent: "html",
    },
    header: {
      "@": {
        title: {
          type: "string",
          control: "text",
        },
        content: {
          control: "text",
          bodyContent: "html",
        },
      },
    },
  },
} as Meta<StoryInput>;

export const WithContent = {
  args: { name: "World", content: "<em>emphasized</em> body" },
} as Story<StoryInput>;

export const WithAttrTagContent = {
  args: {
    name: "Marko",
    content: "<em>emphasized</em> body",
    header: { title: "A header", content: "header <b>markup</b>" },
  },
} as Story<StoryInput>;

export const NoContent = {
  args: { name: "Marko" },
} as Story<StoryInput>;

export const Decorated = {
  args: { name: "Framed", content: "<b>bold</b> body" },
  decorators: [() => ({ component: Border })],
} as Story<StoryInput>;
