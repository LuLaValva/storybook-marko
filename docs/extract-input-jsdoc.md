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
• pressedChange: (no description)
• color: "The currently selected color swatch."
    @default "red"
• colorChange: (no description)
```

It correctly resolves `extends Omit<Marko.HTML.Input, "type">` (the inherited
HTML attributes and their JSDoc are all present on the checked type) and then
filters the result to the component's own attributes — members declared in
external library types are not argTypes.

### Key implementation notes (gotchas already solved)

- TS rejects a `.marko` path as a program **root name** (unknown extension)
  unless `allowNonTsExtensions: true` is set — `mtc` sets the same flag in its
  required compiler options.
- The global `Marko` namespace is **not** ambient by default: each processor
  contributes its type roots via `processor.getRootNames()`, which must be
  merged into the program's root names (otherwise `Marko.HTML.Input` silently
  resolves to an error type and inherited attributes vanish).
- `host.getSourceFile` is overridden to run `processor.extract(file, code)` for
  `.marko` files (as in `mtc`'s `cli.js`).
- `host.resolveModuleNameLiterals` handles the specifier shapes the extractor
  emits, ported from `mtc`: relative/absolute `.marko` paths, bare package
  specifiers (e.g. `@marko/runtime-tags/tags/let.d.marko`), `<tag-name>`
  taglib imports, and `.d.marko` definition-file preference.
- `program.getSemanticDiagnostics(sourceFile)` is checked so resolution or
  extraction failures surface as warnings instead of silently producing an
  incomplete prop list.

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

2. **`docs.extractArgTypes` parameter** in `entry-preview-docs.ts` — that file
   already registers Storybook's `enhanceArgTypes` (from
   `storybook/internal/docs-tools`), whose whole job is to call
   `parameters.docs.extractArgTypes(component)` and merge the result _under_
   author-specified `argTypes`. Supplying an `extractArgTypes` that reads
   `component.__markoDocgen.input` gets the "don't override manual argTypes"
   merge for free and matches how the react/vue/svelte renderers plug docgen
   in — no hand-written enhancer in `entry-preview.ts` needed.

### Follow-ups / open questions

- **Attr tags**: nested `Marko.AttrTag<{ … }>` types (see
  `tests/fixtures/attr-tags`) need the same recursion that `flattenAttrTags`
  does at runtime, descending into the unwrapped element type to document `@`
  sub-attributes.
- **`@default` / `@deprecated`**: map to `table.defaultValue.summary` and a
  deprecation note respectively.
- Decide whether to reuse the project's `tsconfig` or construct a minimal one
  for speed.
