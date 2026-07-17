import {
  enhanceArgTypes,
  extractComponentDescription,
  extractComponentProps,
  hasDocgen,
  SourceType,
} from "storybook/internal/docs-tools";
import type {
  Addon_DecoratorFunction,
  ArgTypesEnhancer,
  StrictArgTypes,
} from "storybook/internal/types";

import type { MarkoStoryResult } from "./types";

export const decorators: Addon_DecoratorFunction<MarkoStoryResult>[] = [];

const extractArgTypes = (component: unknown): StrictArgTypes | null => {
  if (!hasDocgen(component)) return null;
  const argTypes: StrictArgTypes = {};
  for (const { propDef } of extractComponentProps(component, "props")) {
    const { name, description, type, sbType, defaultValue, jsDocTags } =
      propDef;
    argTypes[name] = {
      name,
      description,
      type: { required: propDef.required, ...sbType },
      table: {
        type: type ?? undefined,
        jsDocTags,
        defaultValue: defaultValue ?? undefined,
      },
    };
  }
  return argTypes;
};

export const parameters = {
  docs: {
    story: { inline: true },
    source: {
      type: SourceType.DYNAMIC,
      language: "marko",
    },
    extractArgTypes,
    extractComponentDescription,
  },
};

export const argTypesEnhancers: ArgTypesEnhancer[] = [enhanceArgTypes];

export { applyDecorators } from "./decorators";
