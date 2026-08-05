import type { LoaderContext } from "webpack";

const warned = new Set<string>();

export default function markoDocgenLoader(
  this: LoaderContext<unknown>,
  source: string,
): void {
  const callback = this.async();
  const fileName = this.resourcePath;
  if (fileName.includes("node_modules")) {
    callback(null, source);
    return;
  }
  import("@storybook/marko/docgen")
    .then((docgen) => docgen.withDocgenInfo(source, fileName))
    .then(
      (result) => callback(null, result || source),
      (err) => {
        if (!warned.has(fileName)) {
          warned.add(fileName);
          console.warn(
            `[storybook:marko-docgen] failed to extract docs from ${fileName}`,
            err,
          );
        }
        callback(null, source);
      },
    );
}
