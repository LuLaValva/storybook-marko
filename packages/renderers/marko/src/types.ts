import { WebRenderer } from "@storybook/types";

export type { RenderContext } from "@storybook/types";

export interface MarkoRenderer extends WebRenderer {
  component: any;
  storyResult: any;
}
