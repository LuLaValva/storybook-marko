import {
  enhanceArgTypes,
  extractComponentDescription,
  extractComponentSectionObject,
  hasDocgen,
  SourceType,
} from "storybook/internal/docs-tools";
import type {
  Addon_DecoratorFunction,
  ArgTypesEnhancer,
  StrictArgTypes,
} from "storybook/internal/types";

import { flattenAttrTags } from "./attr-tag";
import { addControllableChangeHandlers } from "./controllable";
import type { DocgenProp } from "./docgen";
import type { MarkoStoryResult } from "./types";

export const decorators: Addon_DecoratorFunction<MarkoStoryResult>[] = [];

const argTypesFromDocgen = (
  docgenProps: Record<string, DocgenProp>,
): StrictArgTypes => {
  const argTypes: StrictArgTypes = {};
  const props = extractComponentSectionObject(docgenProps).filter(
    (prop) => prop !== null,
  );
  // `fooChange` alongside `foo` is the controllable pattern: `foo` is wired
  // up as controllable and the handler is rendered as part of its row.
  const isChangeHandler = (name: string) =>
    name.endsWith("Change") &&
    docgenProps[name]?.tsType.type === "function" &&
    name.slice(0, -"Change".length) in docgenProps;
  for (const { propDef } of props) {
    const { name, description, sbType, defaultValue, jsDocTags } = propDef;
    if (isChangeHandler(name)) continue;
    const { tsType, rest, "@": attrTagProps } = docgenProps[name];
    argTypes[name] = {
      name,
      ...(isChangeHandler(name + "Change") && { controllable: true }),
      description,
      type: { required: propDef.required, ...sbType },
      // docs-tools summarizes eg unions as just "union"; show the type.
      table: {
        type: { summary: tsType.raw },
        jsDocTags,
        defaultValue: defaultValue ?? undefined,
      },
      // Summarizes inherited attributes, so there is no single value to set.
      ...(rest && { control: { disable: true } }),
      ...(attrTagProps && { "@": argTypesFromDocgen(attrTagProps) }),
    };
  }
  return argTypes;
};

const extractArgTypes = (component: unknown): StrictArgTypes | null => {
  if (!hasDocgen<{ props: Record<string, DocgenProp> }>(component)) {
    return null;
  }
  // User argTypes are already flattened when these merge in; match them.
  return flattenAttrTags(
    argTypesFromDocgen(component.__docgenInfo.props),
    undefined,
  )[0];
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

export const argTypesEnhancers: ArgTypesEnhancer[] = [
  enhanceArgTypes,
  // Docgen can mark args controllable after entry-preview named their rows.
  ({ argTypes }) => addControllableChangeHandlers(argTypes),
];

export { applyDecorators } from "./decorators";
