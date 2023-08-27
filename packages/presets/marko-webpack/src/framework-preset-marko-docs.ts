import { StorybookConfig } from "@storybook/core-webpack";
import path from "path";

export const webpackFinal: StorybookConfig["webpackFinal"] = async (config) => {
  // Use the non bundled version of @storybook/marko for our tests.
  config.resolve!.alias["@storybook/marko"] = path.join(
    __dirname,
    "../../client/index.ts"
  );
  if (process.env.NYC_CONFIG) {
    config.devtool = "inline-nosources-source-map";
    config.module ||= {};
    config.module.rules = [
      ...(config.module?.rules || []),
      {
        enforce: "post",
        type: "javascript/auto",
        exclude: /__tests__/,
        include: path.join(__dirname, "../.."),
        loader: "coverage-istanbul-loader",
      },
    ];
  }

  return config;
};
