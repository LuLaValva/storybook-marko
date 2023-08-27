import type {
  ComponentAnnotations,
  Args,
  AnnotatedStoryFn,
  StoryAnnotations,
  StoryContext as GenericStoryContext,
  StrictArgs,
  DecoratorFunction,
  LoaderFunction,
  ProjectAnnotations,
} from "@storybook/types";
import { MarkoRenderer } from "./types";

export type { Args, ArgTypes, Parameters, StrictArgs } from "@storybook/types";

/**
 * Metadata to configure the stories for a component.
 *
 * @see [Default export](https://storybook.js.org/docs/formats/component-story-format/#default-export)
 */
export type Meta<TemplateOrArgs = Args> = ComponentAnnotations<
  MarkoRenderer,
  TemplateInputOrInput<TemplateOrArgs>
>;

/**
 * Story function that represents a CSFv2 component example.
 *
 * @see [Named Story exports](https://storybook.js.org/docs/formats/component-story-format/#named-story-exports)
 */
export type StoryFn<TemplateOrArgs = Args> = AnnotatedStoryFn<
  MarkoRenderer,
  TemplateInputOrInput<TemplateOrArgs>
>;

/**
 * Story object that represents a CSFv3 component example.
 *
 * @see [Named Story exports](https://storybook.js.org/docs/formats/component-story-format/#named-story-exports)
 */
export type StoryObj<MetaOrTemplateOrArgs = Args> = StoryAnnotations<
  MarkoRenderer,
  // TODO: This needs to be more complicated, see svelte and vue
  TemplateInputOrInput<MetaOrTemplateOrArgs>
>;

type TemplateInputOrInput<TemplateOrArgs> =
  TemplateOrArgs extends Marko.Template<infer Input, any>
    ? Input
    : TemplateOrArgs;

export type { MarkoRenderer };
export type Decorator<Args = StrictArgs> = DecoratorFunction<
  MarkoRenderer,
  Args
>;
export type Loader<Args = StrictArgs> = LoaderFunction<MarkoRenderer, Args>;
export type StoryContext<Args = StrictArgs> = GenericStoryContext<
  MarkoRenderer,
  Args
>;
export type Preview = ProjectAnnotations<MarkoRenderer>;
