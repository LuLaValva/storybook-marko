import type { LoaderContext } from "webpack";

export default function markoDocgenLoader(
  this: LoaderContext<unknown>,
  source: string,
): void {
  const callback = this.async();
  import("@storybook/marko/docgen")
    .then(({ withDocgenInfo }) =>
      withDocgenInfo(source, this.resourcePath).then((result) => {
        if (!result) return callback(null, source);
        for (const dependency of result.dependencies) {
          this.addDependency(dependency);
        }
        callback(null, result.code);
      }),
    )
    .catch(() => callback(null, source));
}
