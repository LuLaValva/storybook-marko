---
"@storybook/marko": patch
"@storybook/marko-vite": patch
"@storybook/marko-webpack": patch
---

Docgen: types inherited from outside the project (eg `Input extends Omit<Marko.HTML.Span, "role">`) now show as a single `...Marko.HTML.Span` row instead of disappearing, and `/** @inheritDoc */` on a re-declared prop pulls in the inherited docs. Recursive attribute tags no longer crash extraction, attribute tags are recognized regardless of the configured `lib` and inside unions, each component uses its nearest tsconfig, and the files an `Input` is read from are watched so their docs stay current.
