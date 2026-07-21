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
import type { DocgenProp } from "./docgen";
import type { MarkoStoryResult } from "./types";

export const decorators: Addon_DecoratorFunction<MarkoStoryResult>[] = [];

const argTypesFromDocgen = (component: unknown): StrictArgTypes => {
  const argTypes: StrictArgTypes = {};
  const props = extractComponentProps(component, "props");
  for (const { propDef, docgenInfo } of props) {
    const { name, description, type, sbType, defaultValue, jsDocTags } =
      propDef;
    // `fooChange` alongside `foo` is the controllable pattern, rendered as
    // part of `foo`'s row.
    if (
      name.endsWith("Change") &&
      (docgenInfo as unknown as DocgenProp).tsType?.type === "function" &&
      props.some((other) => other.propDef.name === name.slice(0, -6))
    ) {
      continue;
    }
    const attrTagProps = (docgenInfo as unknown as DocgenProp)["@"];
    argTypes[name] = {
      name,
      description,
      type: { required: propDef.required, ...sbType },
      table: {
        type: type ?? undefined,
        jsDocTags,
        defaultValue: defaultValue ?? undefined,
      },
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

export const argTypesEnhancers: ArgTypesEnhancer[] = [enhanceArgTypes];

export { applyDecorators } from "./decorators";
