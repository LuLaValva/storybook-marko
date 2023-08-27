import { StorybookConfig } from "@storybook/core-webpack";

export const addons: StorybookConfig["addons"] = [
  require.resolve(
    "@storybook/preset-marko-webpack/dist/framework-preset-marko"
  ),
  require.resolve(
    "@storybook/preset-marko-webpack/dist/framework-preset-marko-docs"
  ),
];
