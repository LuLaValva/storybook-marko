import type { LoaderContext } from "webpack";

export default function markoDocgenLoader(
  this: LoaderContext<unknown>,
  source: string,
): void {
  const callback = this.async();
  import("@storybook/marko/docgen")
    .then(({ withDocgenInfo }) =>
      withDocgenInfo(source, this.resourcePath).then((result) =>
        callback(null, result || source),
      ),
    )
    .catch(() => callback(null, source));
}
