import { enhanceArgTypes } from "@storybook/docs-tools";

import { sourceDecorator } from "./sourceDecorator";
import { Addon_DecoratorFunction } from "@storybook/types";

export const parameters: {} = {
  docs: {
    story: { inline: true },
  },
};

export const decorators: Addon_DecoratorFunction<unknown>[] = [sourceDecorator];

export const argTypesEnhancers = [enhanceArgTypes];
