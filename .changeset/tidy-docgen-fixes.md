---
"@storybook/marko": patch
---

Docgen extraction fixes: prop descriptions and JSDoc tags come only from in-project declarations (no more native HTML attribute docs or `@see` links leaking onto re-declared props), intersection-merged declarations no longer repeat their JSDoc, body content declared as `Marko.Body` displays as written instead of `Body<[], void>`, and union `Input` types now include member-only props (as optional) instead of dropping them.
