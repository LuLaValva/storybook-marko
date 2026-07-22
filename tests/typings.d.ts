// Resolved at runtime via the package's "./content-shell.marko" export; the
// declaration output for a referenced project's .marko file is not visible to
// this project, so declare its type here.
declare module "@storybook/marko/content-shell.marko" {
  const template: Marko.Template;
  export default template;
}
