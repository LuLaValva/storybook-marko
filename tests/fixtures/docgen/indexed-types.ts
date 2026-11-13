export interface OtherInput {
  seeMore?: Marko.AttrTag<
    Omit<Marko.HTML.Button, "type"> & {
      /** Shown after the label. */
      extra?: string;
    }
  >;
}
