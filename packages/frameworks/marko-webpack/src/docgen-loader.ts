import type { LoaderContext } from "webpack";

let docgen:
  | Promise<
      typeof import("@storybook/marko/dist/docgen.js") & {
        project?: import("@storybook/marko/dist/docgen.js").MarkoDocgen;
      }
    >
  | undefined;
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

  (docgen ??= import("@storybook/marko/dist/docgen.js").then(
    async (docgenModule) => ({
      ...docgenModule,
      project: await docgenModule.createMarkoDocgen({
        rootDir: process.cwd(),
      }),
    }),
  ))
    .then((mod) => {
      const withDocgen =
        mod.project &&
        mod.attachDocgenInfo(source, mod.project.getDocgenInfo(fileName));
      callback(null, withDocgen || source);
    })
    .catch((err) => {
      if (!warned) {
        warned = true;
        console.warn(
          `[storybook:marko-docgen] failed to extract docs from ${fileName}`,
          err,
        );
      }
      callback(null, source);
    });
}
