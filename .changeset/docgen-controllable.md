---
"@storybook/marko": patch
---

Docgen: an `Input` prop declared with a matching `fooChange` handler is now controllable automatically, so `controllable: true` only needs writing for args whose handler isn't in your own types (eg a native `<input>`'s `value`).
