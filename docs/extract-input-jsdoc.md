# Extracting argType descriptions from `Input` JSDoc

Status: **proof of concept** (`scripts/extract-input-jsdoc.ts`)

## Goal

Today every argType `description` is written by hand in a story's `argTypes`
(see `tests/fixtures/controllable-inputs/stories.ts`). We want the description
to come for free from JSDoc written on the component's exported `Input` type:

```marko
export interface Input {
  /** Whether the toggle button is currently pressed. */
  pressed: boolean;
}
```

…should automatically produce `argTypes.pressed.description = "Whether the
toggle button is currently pressed."`.

We only care about JSDoc **on the `Input` type** — not taglib comments, not
markup. That makes the TypeScript type checker the right tool.

## What the PoC proves

`scripts/extract-input-jsdoc.ts` builds a TypeScript `Program` using the exact
same Marko→TS bridge that `mtc` (`@marko/type-check`) uses internally:
`@marko/language-tools` `Processors`. A `.marko` file's
`export interface Input { … }` becomes a real TS symbol, so we can read each
property's JSDoc with the standard compiler API:

```ts
prop.getDocumentationComment(checker); // → description text
prop.getJsDocTags(checker); // → @default, @deprecated, …
```

Run it:

```sh
node --experimental-strip-types scripts/extract-input-jsdoc.ts \
  tests/fixtures/controllable-inputs/index.marko
```

Output:

```
• pressed: "Whether the toggle button is currently pressed."
• color: "The currently selected color swatch."
    @default "red"
• colorChange: ""
```

It correctly resolves `extends Omit<Marko.HTML.Input, "type">` and reports only
the component's own documented attributes.

### Key implementation notes (gotchas already solved)

- TS rejects a `.marko` path as a program **root name** (unknown extension), so
  the PoC feeds it a virtual `.ts` entry that `import`s the component; the
  `.marko` then loads through overridden module resolution. `mtc` instead
  registers `.marko` as an `extraFileExtension` on a parsed config — either
  works.
- `host.getSourceFile` is overridden to run `processor.extract(file, code)` for
  `.marko` files (verbatim from `mtc`'s `cli.js`).
- `host.resolveModuleNameLiterals` maps `*.marko` specifiers to the file with
  `processor.getScriptExtension(...)`.

## Recommended integration

The runtime `argTypesEnhancers` in
`packages/renderers/marko/src/entry-preview.ts` run **in the browser preview**,
so they cannot invoke `tsc`. Extraction must happen at **build time** and be
shipped to the client, mirroring how `react-docgen-typescript` injects
`__docgenInfo`. Proposed shape:

1. **Builder plugin** (Vite + Webpack) — when a `.marko` component is loaded in
   a Storybook build, run the extractor and append a docgen object to the
   module, e.g.:

   ```js
   Component.__markoDocgen = {
     input: { pressed: { description: "…", tags: { default: '"red"' } } },
   };
   ```

   Reuse one long-lived `Program`/`LanguageService` (incremental) rather than a
   fresh program per file — that is the only real performance concern.

2. **New `argTypesEnhancer`** in `entry-preview.ts` — read
   `component.__markoDocgen.input` and fill in `description` / `table.defaultValue`
   for each argType, **without overriding** anything the author set manually in
   `stories.ts`. It should run before `normalizeArgTypes`.

### Follow-ups / open questions

- **Attr tags**: nested `Marko.AttrTag<{ … }>` types (see
  `tests/fixtures/attr-tags`) need the same recursion that `flattenAttrTags`
  does at runtime, descending into the unwrapped element type to document `@`
  sub-attributes.
- **`@default` / `@deprecated`**: map to `table.defaultValue.summary` and a
  deprecation note respectively.
- Decide whether to reuse the project's `tsconfig` or construct a minimal one
  for speed.
