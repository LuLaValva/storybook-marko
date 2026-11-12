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
  },
} satisfies Meta<Input>;

export const Default = {
  args: { number: 5 },
} as Story<Input>;

export const Empty = {
  args: {},
} as Story<Input>;
