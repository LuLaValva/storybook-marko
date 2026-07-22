---
"@storybook/marko": minor
---

Support `bodyContent` args and decorators for Tags API templates. Body content args — including named args and attribute tag content — and decorated stories are rendered through a `content-shell.marko` template shipped with the package, which mints each content value with a `<define>` so control strings become real compiled body content. Also fixes `bodyContent` args for class API templates being wrapped twice when edited via the controls addon, and applies Marko-style decorators even when docs are disabled.
