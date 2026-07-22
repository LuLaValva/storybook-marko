<h1 align="center">
  <!-- Logo -->
  <img src="https://user-images.githubusercontent.com/4985201/120356895-ad781b00-c2b9-11eb-94dc-2eacc348819b.png" alt="Marko & Storybook Logo" height="118"/>
  <br/>
  <br/>
  Storybook for Marko
	<br/>

  <!-- Language -->
  <a href="http://typescriptlang.org">
    <img src="https://img.shields.io/badge/%3C%2F%3E-typescript-blue.svg" alt="TypeScript"/>
  </a>
  <!-- Format -->
  <a href="https://github.com/prettier/prettier">
    <img src="https://img.shields.io/badge/styled_with-prettier-ff69b4.svg" alt="Styled with prettier"/>
  </a>
  <!-- CI -->
  <a href="https://github.com/storybookjs/marko/actions/workflows/ci.yml">
    <img src="https://github.com/storybookjs/marko/actions/workflows/ci.yml/badge.svg" alt="Build status"/>
  </a>
  <!-- Coverage -->
  <a href="https://codecov.io/gh/storybookjs/marko">
    <img src="https://codecov.io/gh/storybookjs/marko/branch/next/graph/badge.svg?token=SOKUXR8DLB"/>
  </a>
  <!-- NPM Version -->
  <a href="https://npmjs.org/package/@storybook/marko">
    <img src="https://img.shields.io/npm/v/@storybook/marko.svg" alt="NPM Version"/>
  </a>
  <!-- Downloads -->
  <a href="https://npmjs.org/package/@storybook/marko">
    <img src="https://img.shields.io/npm/dm/@storybook/marko.svg" alt="Downloads"/>
  </a>
</h1>

Storybook for Marko is a UI development environment for your Marko components.
With it, you can visualize different states of your UI components and develop them interactively.

<p align="center">
  <img src="https://github.com/storybookjs/storybook/blob/master/media/storybook-intro.gif" alt="Storybook Screenshot"/>
</p>

Storybook runs outside of your app.
So you can develop UI components in isolation without worrying about app specific dependencies and requirements.

## Getting Started

> `@storybook/marko@10` Is for storybook@10 and storybook@9, for storybook@8 use `@storybook/marko@9`.

> `@storybook/marko` >= 7 Only supports Marko 5+.
> For Marko 4 support use `@storybook/marko@6`.

```sh
cd my-marko-app
npx sb init --type marko --builder webpack5
```

For more information visit: [storybook.js.org](https://storybook.js.org)

## Example Stories

### Basic

Story functions in Marko are expected to return an object with two properties.

1. `component`: the template to render
2. `input`: the `input` to render the template with

```js
// button.stories.js
import Button from "./button.marko";

export const Primary = () => ({
  component: Button,
  input: {
    primary: true,
    label: "Button",
  },
});
```

### Common component for stories

Often a `.stories.js` file will export multiple stories using the same `.marko` template.
To simplify things you can set a `component` property on the [`default export` meta data](https://storybook.js.org/docs/react/writing-stories/introduction#default-export).
This will act as the default `component` to render for each story function.

```js
import Button from "./button.marko";

export default {
  title: "Button",
  component: Button,
};

export const Primary = () => ({
  input: {
    primary: true,
    label: "Button",
  },
});

export const Secondary = () => ({
  input: {
    primary: false,
    label: "Button",
  },
});
```

### Using Args

[Storybooks `args`](https://storybook.js.org/docs/react/writing-stories/args) provide a way to better document, simplify and configure the input passed to your templates.
Each story function will receive `args` as the first parameter, or you can simply export an object with the story meta (including `args`).

```js
import Button from "./button.marko";

export default {
  title: "Button",
  component: Button,
};

// When exporting a function, args are received.
export const Primary = (args) => ({ input: args });
Primary.args = {
  primary: true,
  label: "Button",
};

// Alternatively export an object with args which
// will always render the default exported component.
export const Secondary = {
  args: {
    primary: false,
    label: "Button",
  },
};
```

### Using Decorators

[Storybook `decorators`](https://storybook.js.org/docs/writing-stories/decorators) provide a way to wrap a component with another component to provide context, styling, or additional functionality.

With `@storybook/marko` your decorators _must_ be a function that returns the same signature as the story functions.
The `component` specified in the decorator will be provided the nested `Story` (or another decorator) as body content — [`input.renderBody`](https://markojs.com/docs/syntax/#dynamic-body-content) in the class API, [`input.content`](https://markojs.com/docs/reference/language#tag-content) in the Tags API — which it can render with a dynamic tag.

```js
import Button from "./button.marko";
import Decorator from "./decorator.marko";

export default {
  title: "Button",
  component: Button,
  decorators: [
    () => ({
      component: Decorator,
      input: {
        // optionally pass some input to the decorator
      },
    }),
  ],
};

export const Primary = {
  args: {
    // ...
  },
};
```

### Body content controls

Marko components often receive [body content](https://markojs.com/docs/reference/language#tag-content) (`input.content` in the Tags API, `input.renderBody` in the class API). Content values are compiled constructs, so controls cannot edit them directly — instead, mark an arg with `bodyContent` and the string value of that arg is rendered as the component's body content:

```js
import Alert from "./alert.marko";

export default {
  title: "Alert",
  component: Alert,
  argTypes: {
    content: {
      control: "text",
      // "html" renders the string as raw HTML, "text" (or `true`) escapes it.
      bodyContent: "html",
    },
  },
};

export const Warning = {
  args: { content: "Something <b>bad</b> happened!" },
};
```

This works for any content arg — `content` itself, other `Marko.Body`-typed args, and [attribute tag](https://markojs.com/docs/reference/language#attribute-tags) content via nested `"@"` argTypes:

```js
argTypes: {
  header: {
    "@": {
      title: { control: "text" },
      content: { control: "text", bodyContent: "html" },
    },
  },
},
```

Both the class API and the Tags API are supported (up to 4 content args per story for Tags API components). Under the hood, Tags API stories are mounted through a small shell template shipped with this package (`content-shell.marko`) that creates each content value with a [`<define>`](https://markojs.com/docs/reference/core-tag#define). This means the builder compiling your stories must also compile `.marko` files imported from `node_modules` (the `@storybook/marko-vite` and `@storybook/marko-webpack` frameworks already do), and it must be Marko 6 or a Marko 5 release recent enough to include the Tags API interop.

When rendering composed stories outside Storybook (e.g. in vitest or jest), register the shell yourself if your Tags API stories use `bodyContent` args or decorators:

```ts
import { setContentShell } from "@storybook/marko";
import contentShell from "@storybook/marko/content-shell.marko";

setContentShell(contentShell);
```

### Using with TypeScript

Some types are exposed by this module to make it easier to write your stores using TypeScript.
Here is a simple story using the exposed types.

```ts
import type { Story, Meta } from "@storybook/marko";
import Button from "./button.marko";

interface ButtonInput {
  primary?: boolean;
  label: string;
}

export default {
  title: "Button",
  component: Button,
} as Meta<ButtonInput>;

export const Primary: Story<ButtonInput> = {
  args: {
    primarrrrry: true, // Will error with typescript!
  },
};
```

## Testing

`@storybook/marko` also ships with tools to make loading and rendering your stories in your tests easy! See our [testing documentation](./testing.md) for more details.

## Docs

- [Basics](https://storybook.js.org/docs/marko/get-started/introduction)
- [Configurations](https://storybook.js.org/docs/marko/configure/overview)
- [Addons](https://storybook.js.org/docs/marko/configure/storybook-addons)
