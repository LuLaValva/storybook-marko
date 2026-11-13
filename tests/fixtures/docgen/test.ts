import path from "node:path";

import { type DocgenProp, withDocgenInfo } from "@storybook/marko/docgen";

const docgenReg = /__docgenInfo = (.*); } catch/;

async function extract(file: string) {
  const fileName = path.join(import.meta.dirname, file);
  const result = await withDocgenInfo("export default {};\n", fileName);
  expect(result).toBeTruthy();
  return {
    props: JSON.parse(docgenReg.exec(result!.code)![1]).props as Record<
      string,
      DocgenProp
    >,
    dependencies: result!.dependencies.map((dependency) =>
      path.relative(import.meta.dirname, dependency),
    ),
  };
}

describe("docgen", () => {
  test("stops expanding recursive attribute tags", async () => {
    const { props } = await extract("tree.marko");
    const nested = props.item["@"]!;
    expect(nested.label.description).toBe("The item's label.");
    expect(nested.item.tsType).toEqual({ name: "AttrTag" });
    expect(nested.item["@"]).toEqual({});
  });

  test("expands attribute tags within a union", async () => {
    const { props } = await extract("mixed.marko");
    expect(props.title.tsType.name).toBe("union");
    expect(props.title["@"]!.level.description).toBe("The heading level.");
  });

  test("detects attribute tags without ES2015 lib types", async () => {
    const { props } = await extract("es5/attr-tag.marko");
    expect(props.item["@"]!.name.description).toBe("The item name.");
  });

  test("lists in-project bases and summarizes external ones", async () => {
    const { props, dependencies } = await extract("extends.marko");
    expect(Object.keys(props).sort()).toEqual([
      "...Marko.HTML.Span",
      "base",
      "heading",
      "hidden",
      "shared",
      "title",
    ]);
    expect(props.base.description).toBe("Declared on an in-project base.");
    expect(props.shared.description).toBe("Declared in a separate file.");
    expect(dependencies).toEqual(["shared.ts"]);

    expect(props["...Marko.HTML.Span"]).toMatchObject({
      rest: true,
      required: false,
      tsType: {
        name: 'Omit<Marko.HTML.Span, "role" | "aria-label" | `on${string}`>',
      },
    });
    expect(props["...Marko.HTML.Span"].description).toMatch(
      /native \[`<span>` tag\]\(.*\/span\), except `role`, `aria-label`, `on\*`\.$/,
    );
    expect(Object.keys(props.heading["@"]!).sort()).toEqual([
      "...Marko.HTML.H1",
      "text",
    ]);
  });

  test("inherits external docs only with @inheritDoc", async () => {
    const { props } = await extract("extends.marko");
    expect(props.hidden.description).toMatch(/hidden from rendering/);
    expect(props.title.description).toBe(
      "Overrides the native title without inheriting its docs.",
    );
  });

  test("sees through Omit of in-project types and Marko.Input", async () => {
    const { props } = await extract("omit-local.marko");
    expect(props.base).toBeUndefined();
    expect(props.shared.description).toBe("Declared in a separate file.");
    expect(props["...Marko.HTML.Span"].description).toMatch(
      /, except `hidden`, `title`, `role`, `aria-label`, `on\*`\.$/,
    );
    expect(props.label["@"]!['...Marko.Input<"label">'].description).toMatch(
      /native \[`<label>` tag\]/,
    );
  });
});
