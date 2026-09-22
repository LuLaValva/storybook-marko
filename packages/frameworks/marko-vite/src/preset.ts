import { hasVitePlugins } from "@storybook/builder-vite";
import type { PresetProperty } from "storybook/internal/types";

import type { StorybookConfig } from "./types";

export const core: PresetProperty<"core"> = async (config, options) => {
  const framework = await options.presets.apply("framework");

  return {
    ...config,
    builder: {
      name: "@storybook/builder-vite",
      options:
        /* c8 ignore next */
        typeof framework === "string" ? {} : framework.options.builder || {},
    },
    renderer: "@storybook/marko",
  };
};

function markoDocgenPlugin(): import("vite").Plugin {
  return {
    name: "storybook:marko-docgen",
    enforce: "post",
    async transform(code, id, options) {
      // `__docgenInfo` is only read in the browser.
      if (options?.ssr) return;
      const [fileName] = id.split("?");
      if (!fileName.endsWith(".marko")) return;
      const { withDocgenInfo } = await import("@storybook/marko/docgen");
      const result = await withDocgenInfo(code, fileName);
      return result ? { code: result, map: null } : undefined;
    },
  };
}

export const viteFinal: StorybookConfig["viteFinal"] = async (
  viteConfig,
  storybookConfig,
) => {
  const { mergeConfig } = await import("vite");
  return mergeConfig(viteConfig, {
    resolve: {
      alias: [
        {
          // Fixes https://github.com/storybookjs/storybook/issues/23147
          find: /^~/,
          replacement: "",
        },
      ],
    },
    server:
      storybookConfig.host && viteConfig.server?.allowedHosts === undefined
        ? { allowedHosts: [storybookConfig.host] }
        : undefined,
    plugins: [
      // Ensure @marko/vite included unless already added.
      ...((await hasVitePlugins(viteConfig.plugins || [], ["marko-vite:pre"]))
        ? []
        : [(await import("@marko/vite")).default({ linked: false })]),
      markoDocgenPlugin(),
    ],
  });
};
