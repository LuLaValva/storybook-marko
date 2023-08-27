import { StorybookConfig } from "@storybook/core-webpack";

export const webpack: StorybookConfig["webpack"] = (config) => {
  return {
    ...config,
    module: {
      ...config.module,
      rules: [
        ...config.module!.rules!,
        {
          test: /\.marko$/,
          loader: require.resolve("@marko/webpack/loader"),
        },
      ],
    },
    resolve: {
      ...config.resolve,
      extensions: [...config.resolve!.extensions!, ".marko"],
    },
  };
};
