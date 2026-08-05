---
"@storybook/marko": patch
---

Replace docgen's hand-rolled TypeScript language-service host with the `createLanguageService` factory that `@marko/language-tools` 2.7 now exports (processor-aware snapshots, `<tag>` import resolution, mtime-based script versions, and root-name seeding all live upstream). Docgen output is unchanged. Installs that resolve an older `@marko/language-tools` simply get no docgen, the same graceful degradation as installs without the optional `typescript` peer; refresh the lockfile to pick up 2.7+.
