import type { StrictArgTypes } from "storybook/internal/types";

/**
 * Names each controllable arg's row after its `Change` handler too. Runs
 * again once docgen has merged in, so it leaves rows it already named.
 */
export function addControllableChangeHandlers(argTypes: StrictArgTypes) {
  for (const key in argTypes) {
    const argType = argTypes[key];
    const name = argType.name || key;

    if (
      argType.controllable &&
      !argTypes[key + "Change"] &&
      !name.endsWith("Change")
    ) {
      argTypes[key].name = name + ", " + name + "Change";
    }
  }
  return argTypes;
}
