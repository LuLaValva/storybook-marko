import type { Meta, Story } from "@storybook/marko";

import AttrTags, { type Input } from "./index.marko";

export default {
  title: "AttrTags",
  component: AttrTags,
  parameters: {
    docs: {
      description: {
        component: "A component that renders attribute tags",
      },
    },
  },
  argTypes: {
    item: {
      "@": {
        icon: {
          "@": {
            size: {
              controllable: true,
              control: { type: "inline-radio" },
            },
          },
        },
      },
    },
  },
} as Meta<Input>;

export const Default = {
  parameters: {
    docs: {
      source: {
        code: `<attr-tags/>`,
      },
    },
  },
} as Story<Input>;

export const InitialValues = {
  args: {
    header: {
      description: "Hello",
    } as any,
    item: {
      count: 5,
      name: "world",
      icon: {
        size: "small",
      },
    } as any,
  },
  parameters: {
    docs: {
      source: {
        code: `<attr-tags/>`,
      },
    },
  },
} as Story<Input>;
