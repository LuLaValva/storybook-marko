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
import type { DocgenProp } from "./docgen";
import { isTagsAPI } from "./render";
import type { MarkoStoryResult } from "./types";

/** Marko's own test for an event handler attribute, eg `onClick`, `on-click`. */
const handlerReg = /^on[-A-Z]/;

export const decorators: Addon_DecoratorFunction<MarkoStoryResult>[] = [];

const argTypesFromDocgen = (
  docgenProps: Record<string, DocgenProp>,
  classApi: boolean,
): StrictArgTypes => {
  const argTypes: StrictArgTypes = {};
  // docs-tools reads the first prop to tell the type system, so needs one.
  if (!Object.keys(docgenProps).length) return argTypes;
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
    const { tsType, "@": attrTagProps } = docgenProps[name];
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
      ...(attrTagProps && {
        "@": argTypesFromDocgen(attrTagProps, classApi),
      }),
    };
  }
  return argTypes;
};

const extractArgTypes = (component: Marko.Template): StrictArgTypes | null => {
  if (!hasDocgen<{ props: Record<string, DocgenProp> }>(component)) {
    return null;
  }
  // User argTypes are already flattened when these merge in; match them.
  const argTypes = flattenAttrTags(
    argTypesFromDocgen(component.__docgenInfo.props, !isTagsAPI(component)),
    undefined,
  )[0];
  for (const key in argTypes) {
    // Only a story's own `"@"` argTypes also flatten its args (which custom
    // renders may not expect); docgen's just document the attributes.
    delete argTypes[key]["@"];
    // Skips attr tags' handlers (keyed `@tag > onFoo`): an action arg for one
    // would create the tag.
    if (handlerReg.test(key) && argTypes[key].type?.name === "function") {
      argTypes[key].action = key;
      argTypes[key].table = { ...argTypes[key].table, category: "Events" };
    }
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
