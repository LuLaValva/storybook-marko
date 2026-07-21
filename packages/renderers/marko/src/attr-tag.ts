import type {
  Args,
  StrictArgTypes,
  StrictInputType,
} from "storybook/internal/types";

type Attrs = Record<PropertyKey, unknown>;
type AttrTag = Attrs & { [rest]: Attrs[] };
const empty: never[] = [];
const rest = Symbol("Attribute Tag");

export function attrTag(attrs: Attrs): AttrTag {
  attrs[Symbol.iterator] = attrTagIterator;
  attrs[rest] = empty;
  return attrs as AttrTag;
}

function* attrTagIterator(this: AttrTag) {
  yield this;
  yield* this[rest];
}

/** Flattens `"@"` nested attr tag argTypes (and args) into `@parent > child` keys. */
export function flattenAttrTags(
  argTypes: StrictArgTypes,
  args: Args | undefined,
  prefix = "",
) {
  const newArgTypes: StrictArgTypes = {};
  const newArgs: Args | undefined = args ? {} : undefined;

  for (const key in argTypes) {
    if (key.startsWith("@")) continue;
    const argType = argTypes[key];
    const name = argType.name || key;
    const table = prefix
      ? {
          ...argType.table,
          category: prefix.substring(0, prefix.length - 3),
          subcategory: argType.table?.subcategory || argType.table?.category,
        }
      : argType.table;

    if (argType["@"]) {
      newArgTypes[prefix + key] = {
        ...argType,
        name: "@" + name,
        control: { disable: true },
        table,
      };
      newArgs && (newArgs[prefix + key] = null);

      const [otherArgTypes, otherArgs] = flattenAttrTags(
        argType["@"] as StrictInputType,
        args?.[key],
        prefix + "@" + key + " > ",
      );

      Object.assign(newArgTypes, otherArgTypes);
      newArgs && Object.assign(newArgs, otherArgs);
    } else {
      newArgTypes[prefix + key] = { ...argType, name, table };
      if (args && key in args) {
        newArgs![prefix + key] = args[key];
      }
    }
  }

  return [newArgTypes, newArgs] as const;
}
