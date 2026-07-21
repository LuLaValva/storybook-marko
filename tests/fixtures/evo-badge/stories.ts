import type { Meta, Story } from "@storybook/marko";

import Badge, { type Input } from "./index.marko";

export default {
  title: "EvoBadge",
  component: Badge,
  argTypes: {
    number: {
      control: "number",
    },
    type: {
      control: "inline-radio",
    },
    a11yText: {
      control: "text",
    },
    ["<span> attributes" as any]: {
      description:
        "All attributes and event handlers from [the native HTML `<span>` tag](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/span) will be passed through, except `role`.",
    },
  },
} satisfies Meta<Input>;

export const Default = {
  args: { number: 5 },
} as Story<Input>;

export const Empty = {
  args: {},
} as Story<Input>;
