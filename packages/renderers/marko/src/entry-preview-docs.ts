import {
  createSummaryValue,
  enhanceArgTypes,
  extractComponentDescription,
  extractComponentSectionObject,
  hasDocgen,
  isTooLongForTypeSummary,
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
  classApi: boolean,
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
    // A Marko 5 component gets dashed attributes camelCased, so its stories
    // name args (and event handlers, eg `onSelect`) that way.
    const key = classApi
      ? name.replace(/-(\w)/g, (_, char: string) => char.toUpperCase())
      : name;
    argTypes[key] = {
      name: key,
      ...(isChangeHandler(name + "Change") && { controllable: true }),
      description,
      type: { required: propDef.required, ...sbType },
      table: {
        // docs-tools summarizes eg a union as just "union"; show the type,
        // with a long one shortened the way docs-tools does.
        type: isTooLongForTypeSummary(tsType.raw)
          ? createSummaryValue(tsType.name, tsType.raw)
          : createSummaryValue(tsType.raw),
        jsDocTags,
        defaultValue: defaultValue ?? undefined,
      },
      // Summarizes inherited attributes, so there is no single value to set.
      ...(rest && { control: { disable: true } }),
      ...(attrTagProps && {
        "@": argTypesFromDocgen(attrTagProps, classApi),
      }),
    };
  }
  return argTypes;
};

const extractArgTypes = (component: unknown): StrictArgTypes | null => {
  if (!hasDocgen<{ props: Record<string, DocgenProp> }>(component)) {
    return null;
  }
  // User argTypes are already flattened when these merge in; match them.
  const argTypes = flattenAttrTags(
    argTypesFromDocgen(component.__docgenInfo.props, "renderSync" in component),
    undefined,
  )[0];
  // Only a story's own `"@"` argTypes also flatten its args (which custom
  // renders may not expect); docgen's just document the attributes.
  for (const key in argTypes) delete argTypes[key]["@"];
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

export const argTypesEnhancers: ArgTypesEnhancer[] = [
  enhanceArgTypes,
  // Docgen can mark args controllable after entry-preview named their rows.
  ({ argTypes }) => addControllableChangeHandlers(argTypes),
];

export { applyDecorators } from "./decorators";
