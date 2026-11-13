import type { StrictArgTypes } from "storybook/internal/types";

/** A row already named `foo, fooChange`. */
const renamedReg = /^(.+), \1Change$/;

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
      !renamedReg.test(name)
    ) {
      argTypes[key].name = name + ", " + name + "Change";
    }
  }
  return argTypes;
}
