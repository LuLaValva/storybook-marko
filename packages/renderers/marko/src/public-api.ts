import { start } from "@storybook/core-client";
import { renderToCanvas, render } from "./render";
import { Addon_ClientStoryApi, Addon_Loadable } from "@storybook/types";
import { MarkoRenderer } from "./types";

interface ClientApi extends Addon_ClientStoryApi<MarkoRenderer["storyResult"]> {
  configure(loader: Addon_Loadable, module: NodeModule): void;
  forceReRender(): void;
  raw(): any; // TODO: add type (also todo in all other renderers)
}

const renderer = "marko";
const api = start(renderToCanvas, { render });

export const storiesOf = (kind: string, m: any) =>
  api.clientApi.storiesOf(kind, m).addParameters({ renderer });

export const configure = (
  loadable: any,
  m: any,
  showDeprecationWarning: boolean
) => api.configure(renderer, loadable, m, showDeprecationWarning);

export const forceReRender = api.forceReRender;
export const raw = api.clientApi.raw;
