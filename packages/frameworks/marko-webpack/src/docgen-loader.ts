import type { LoaderContext } from "webpack";

export default function markoDocgenLoader(
  this: LoaderContext<unknown>,
  source: string,
  map: Parameters<LoaderContext<unknown>["callback"]>[2],
): void {
  const callback = this.async();
  import("@storybook/marko/docgen")
    .then(({ withDocgenInfo }) => withDocgenInfo(source, this.resourcePath))
    .then(
      (result) => {
        for (const dependency of result?.dependencies || []) {
          this.addDependency(dependency);
        }
        // Positions are unchanged, so the incoming source map still applies.
        callback(null, result?.code ?? source, map);
      },
      () => callback(null, source, map),
    );
}
