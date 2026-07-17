import path from "node:path";

import type { PresetProperty } from "storybook/internal/types";

import type { StorybookConfig } from "./types";

export const core: PresetProperty<"core"> = async (config, options) => {
  const framework = await options.presets.apply("framework");

  return {
    ...config,
    builder: {
      name: "@storybook/builder-webpack5",
      options:
        /* c8 ignore next */
        typeof framework === "string" ? {} : framework.options.builder || {},
    },
    renderer: "@storybook/marko",
  };
};

export const webpackFinal: StorybookConfig["webpackFinal"] = async (
  baseConfig,
) => {
  return {
    ...baseConfig,
    module: {
      ...baseConfig.module,
      rules: [
        ...baseConfig.module!.rules!,
        {
          test: /\.marko$/,
          use: [
            // Runs on the compiled output of @marko/webpack/loader (loaders
            // apply right-to-left) to attach docgen info for storybook docs.
            {
              loader: path.join(import.meta.dirname, "docgen-loader.js"),
            },
            { loader: "@marko/webpack/loader" },
          ],
        },
      ],
    },
  };
};
