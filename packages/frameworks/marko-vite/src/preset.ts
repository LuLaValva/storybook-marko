import { hasVitePlugins } from "@storybook/builder-vite";
import type { PresetProperty } from "@storybook/types";
import { dirname, join } from "path";
import { StorybookConfig } from "./types";
import { PluginOption, mergeConfig } from "vite";
import { markoDocgen } from "./plugins/marko-docgen";

const getAbsolutePath = <I extends string>(input: I): I =>
  dirname(require.resolve(join(input, "package.json"))) as any;

export const core: PresetProperty<"core", StorybookConfig> = {
  builder: getAbsolutePath("@storybook/builder-vite"),
  renderer: getAbsolutePath("@storybook/marko-vite"),
};

export const viteFinal: NonNullable<StorybookConfig["viteFinal"]> = async (
  config
) => {
  const plugins: PluginOption[] = [];

  if (!(await hasVitePlugins(plugins, ["@marko/vite"]))) {
    const { default: marko } = await import("@marko/vite");
    plugins.push(marko());
  }

  plugins.push(markoDocgen());

  return mergeConfig(config, {
    plugins,
  });
};
