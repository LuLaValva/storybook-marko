---
"@storybook/marko": patch
"@storybook/marko-vite": patch
"@storybook/marko-webpack": patch
---

Docgen polish: the vite plugin skips SSR transforms (`__docgenInfo` is only read in the browser), docgen is exposed via a proper `@storybook/marko/docgen` export instead of a deep `dist` import, `@marko/language-tools` is loaded lazily so a failure to load degrades to skipping docs extraction, and extraction warnings are reported once per file instead of once overall.
