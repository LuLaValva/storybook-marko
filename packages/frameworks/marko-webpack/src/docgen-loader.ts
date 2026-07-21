import type { LoaderContext } from "webpack";

let warned = false;

/**
 * Runs after `@marko/webpack/loader` and appends the component's
 * `__docgenInfo` (extracted from its `Input` type) to the compiled module.
 */
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
  import("@storybook/marko/dist/docgen.js")
    .then((docgen) => docgen.withDocgenInfo(source, fileName))
    .then(
      (result) => callback(null, result || source),
      (err) => {
        if (!warned) {
          warned = true;
          console.warn(
            `[storybook:marko-docgen] failed to extract docs from ${fileName}`,
            err,
          );
        }
        callback(null, source);
      },
    );
}
