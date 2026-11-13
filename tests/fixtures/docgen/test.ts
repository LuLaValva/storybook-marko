import fs from "node:fs/promises";
import path from "node:path";

import { type DocgenProp, withDocgenInfo } from "@storybook/marko/docgen";

const docgenReg = /__docgenInfo = (.*);$/m;

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
    expect(nested.item.tsType).toEqual({ name: "AttrTag", raw: "AttrTag" });
    expect(nested.item["@"]).toEqual({});
  });

  test("expands attribute tags within a union", async () => {
    const { props } = await extract("mixed.marko");
    expect(props.title.tsType.name).toBe("union");
    expect(props.title["@"]!.level.description).toBe("The heading level.");
  });

  test("treats a union of handlers as a handler", async () => {
    const { props } = await extract("mixed.marko");
    expect(props.valueChange.tsType).toMatchObject({
      name: "signature",
      type: "function",
    });
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

  test("resolves in-project types, showing external names as written", async () => {
    const { props } = await extract("types.marko");
    expect(props.content.tsType).toEqual({
      name: "signature",
      type: "function",
      raw: "Marko.Body",
    });
    expect(props.size.tsType).toEqual({
      name: "union",
      raw: '"small" | "large"',
      elements: [
        { name: "literal", value: '"small"', raw: '"small"' },
        { name: "literal", value: '"large"', raw: '"large"' },
      ],
    });
    expect(props.flag.tsType).toEqual({ name: "boolean", raw: "boolean" });
    expect(props.label.tsType).toEqual({
      name: "string",
      raw: "string | null",
    });
    expect(props.index.tsType.raw).toBe("string | number");
    expect(props.tag.tsType.raw).toBe("keyof Marko.NativeTags");
    expect(props.mode.tsType.elements!.map((e) => e.name)).toEqual([
      "true",
      "literal",
    ]);
    expect(props.items.tsType.raw).toBe("{ label: string; }[]");
    expect(props.state.tsType.raw).toBe(
      '"loading" | "expand" | "reset" | "none"',
    );
  });

  test("documents an Input naming another type from that type", async () => {
    const fileName = path.join(import.meta.dirname, "named-input.marko");
    const result = await withDocgenInfo("export default {};\n", fileName);
    const info = JSON.parse(docgenReg.exec(result!.code)![1]);
    expect(info.description).toBe("Documented where it is declared.");
    expect(Object.keys(info.props)).toEqual(["label", "...Marko.HTML.Span"]);
  });

  test("documents a split component's Input from its browser file", async () => {
    const fileName = path.join(
      import.meta.dirname,
      "../split-component/index.marko",
    );
    const result = await withDocgenInfo("export default {};\n", fileName);
    const info = JSON.parse(docgenReg.exec(result!.code)![1]);
    expect(info.description).toBe(
      "A split component that greets someone and renders body content.",
    );
    expect(info.props.name.description).toBe("Who to greet.");
  });

  test("summarizes the bases of a union Input", async () => {
    const { props } = await extract("mixed.marko");
    expect(props["...Marko.HTML.Div"].rest).toBe(true);
  });

  test("describes a Pick as written", async () => {
    const { props } = await extract("pick.marko");
    expect(Object.keys(props)).toEqual([
      '...Pick<Marko.HTML.Span, "title" | "id">',
    ]);
    expect(props['...Pick<Marko.HTML.Span, "title" | "id">'].description).toBe(
      'Also accepts the members of `Pick<Marko.HTML.Span, "title" | "id">`.',
    );
  });

  test("uses the project a solution tsconfig references", async () => {
    const { props } = await extract("solution/index.marko");
    expect(props.label.tsType.raw).toBe("string | null");
  });

  test("finds the referenced project for a component added later", async () => {
    await extract("solution/index.marko");
    const added = path.join(import.meta.dirname, "solution/added.marko");
    await fs.copyFile(
      path.join(import.meta.dirname, "solution/index.marko"),
      added,
    );
    try {
      const { props } = await extract("solution/added.marko");
      expect(props.label.tsType.raw).toBe("string | null");
    } finally {
      await fs.rm(added);
    }
  });

  test("keeps the parameter name of @param tags", async () => {
    const { props } = await extract("solution/index.marko");
    expect(props.label.description).toContain("@param unused not a real param");
  });

  test("keeps pattern keys omitted from an in-project base", async () => {
    const { props } = await extract("omit-pattern.marko");
    expect(props["...Marko.HTML.Div"].description).toMatch(
      /, except `on\*`, `role`\.$/,
    );
  });

  test("watches files that only declare a prop's type", async () => {
    const { props, dependencies } = await extract("omit-pattern.marko");
    expect(props.size.tsType.raw).toBe('"small" | "large"');
    expect(dependencies).toContain("size.ts");
  });

  test("summarizes props a mapped type renames or spreads", async () => {
    const { props } = await extract("mapped.marko");
    expect(Object.keys(props).sort()).toEqual([
      "...Marko.HTML.Img",
      "...Marko.HTML.Span",
      "item",
      "mine",
    ]);
  });

  test("shows a re-declared native attribute as declared", async () => {
    const { props } = await extract("redeclare.marko");
    expect(props.onClick.tsType.raw).toBe("(event: MouseEvent) => void");
    expect(props.class.tsType.raw).toBe("string");
    expect(props.class.description).toBe("Extra classes.");
  });

  test("follows an attribute tag typed by indexed access", async () => {
    const { props, dependencies } = await extract("indexed.marko");
    expect(Object.keys(props.seeMore["@"]!).sort()).toEqual([
      "...Marko.HTML.Button",
      "extra",
    ]);
    expect(dependencies).toContain("indexed-types.ts");
  });

  test("shows identical union members once", async () => {
    const { props } = await extract("duplicates.marko");
    expect(props.selected.tsType.raw.match(/from/g)).toHaveLength(1);
  });
});
