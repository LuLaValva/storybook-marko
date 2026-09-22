---
"@storybook/marko": patch
"@storybook/marko-vite": patch
"@storybook/marko-webpack": patch
---

Docgen polish: attribute tag props are now recognized by the `Marko.AttrTag` shape rather than the alias symbol, so aliases of it (eg `export type Header = Marko.AttrTag<{...}>`) document their nested attributes too. The vite plugin skips SSR transforms (`__docgenInfo` is only read in the browser), docgen is exposed via a proper `@storybook/marko/docgen` export instead of a deep `dist` import (and the framework packages now depend on `@storybook/marko` explicitly, since they import it), `@marko/language-tools` is loaded lazily so a failure to load degrades to skipping docs extraction, and extraction warnings are reported once per file instead of once overall.
