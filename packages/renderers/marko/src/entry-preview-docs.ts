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

import { flattenAttrTags } from "./attr-tag";
import { addControllableChangeHandlers } from "./controllable";
import type { DocgenProp } from "./docgen";
import type { MarkoStoryResult } from "./types";

export const decorators: Addon_DecoratorFunction<MarkoStoryResult>[] = [];

const argTypesFromDocgen = (component: unknown): StrictArgTypes => {
  const argTypes: StrictArgTypes = {};
  const props = extractComponentProps(component, "props");
  // `fooChange` alongside `foo` is the controllable pattern: `foo` is wired
  // up as controllable and the handler is rendered as part of its row.
  const controllable = new Set<string>();
  for (const { propDef, docgenInfo } of props) {
    const { tsType } = docgenInfo as unknown as DocgenProp;
    const name = propDef.name.slice(0, -"Change".length);
    if (
      propDef.name.endsWith("Change") &&
      tsType?.type === "function" &&
      props.some((other) => other.propDef.name === name)
    ) {
      controllable.add(name);
    }
  }
  for (const { propDef, docgenInfo } of props) {
    const { name, description, type, sbType, defaultValue, jsDocTags } =
      propDef;
    const {
      tsType,
      rest,
      "@": attrTagProps,
    } = docgenInfo as unknown as DocgenProp;
    if (
      name.endsWith("Change") &&
      controllable.has(name.slice(0, -"Change".length))
    ) {
      continue;
    }
    argTypes[name] = {
      name,
      ...(controllable.has(name) && { controllable: true }),
      description,
      type: { required: propDef.required, ...sbType },
      table: {
        // docs-tools summarizes unions and literals by kind; show the type.
        type:
          tsType?.raw || tsType?.name === "literal"
            ? { summary: tsType.raw ?? tsType.value! }
            : (type ?? undefined),
        jsDocTags,
        defaultValue: defaultValue ?? undefined,
      },
      // Summarizes inherited attributes, so there is no single value to set.
      ...(rest && { control: { disable: true } }),
      ...(attrTagProps && {
        "@": argTypesFromDocgen({ __docgenInfo: { props: attrTagProps } }),
      }),
    };
  }
  return argTypes;
};

const extractArgTypes = (component: unknown): StrictArgTypes | null => {
  if (!hasDocgen(component)) return null;
  // User argTypes are already flattened when these merge in; match them.
  return flattenAttrTags(argTypesFromDocgen(component), undefined)[0];
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
