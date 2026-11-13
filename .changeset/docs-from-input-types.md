---
"@storybook/marko": minor
"@storybook/marko-vite": minor
"@storybook/marko-webpack": minor
---

Generate controls and autodocs from each component's exported `Input` type. With `typescript` installed and docs enabled, a doc comment on `Input` becomes the component's description, and every prop's JSDoc description, `@default`, type and required-ness fills the args table, including the nested members of attribute tags. Unions of literals become option controls, a `fooChange` handler next to `foo` makes `foo` controllable, and props inherited from outside the project (eg `extends Marko.HTML.Button`) are left out. `argTypes` in stories still override anything extracted. A Marko 5 (class API) component's dashed attributes and handlers are documented camelCased (eg `cdnUrl`, `onSelect`), the names they reach it by, so its stories' `argTypes` and `args` should use those names.
