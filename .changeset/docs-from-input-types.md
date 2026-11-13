---
"@storybook/marko": minor
"@storybook/marko-vite": minor
"@storybook/marko-webpack": minor
---

Generate controls and autodocs from each component's exported `Input` type. With `typescript` installed and docs enabled, every prop's JSDoc description, `@default`, type and required-ness fills the args table, including the nested members of attribute tags. Unions of literals become option controls, a `fooChange` handler next to `foo` makes `foo` controllable, and types inherited from outside the project (eg `extends Marko.HTML.Button`) are summarized in one row. `argTypes` in stories still override anything extracted.
