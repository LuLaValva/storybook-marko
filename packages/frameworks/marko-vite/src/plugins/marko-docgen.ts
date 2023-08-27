import MagicString from "magic-string"; // used in solid's docgen (https://github.com/storybookjs/solidjs/blob/main/packages/frameworks/solid-vite/src/plugins/solid-docgen.ts)
import { PluginOption, createFilter } from "vite";

export function markoDocgen(): PluginOption {
  const include = /\.marko$/;
  const filter = createFilter(include);

  return {
    name: "marko-docgen-plugin",
    async transform(code, id) {
      if (!filter(id)) return undefined;

      const s = new MagicString(code);
      return {
        code: s.toString(),
        map: s.generateMap({ hires: true, source: id }),
      };
    },
  };
}
