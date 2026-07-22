/// <reference types="marko" />

import "./globals";
export { setContentShell } from "./content-shell";
export * from "./public-types";
export * from "./testing-api";

// optimization: stop HMR propagation in webpack
if (typeof module !== "undefined") (module as any)?.hot?.decline();
