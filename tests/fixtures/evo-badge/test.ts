import { render, screen } from "@marko/testing-library";
import { composeStories } from "@storybook/marko";
import { expect } from "playwright/test";

import { testPage } from "../../test-page";
import * as stories from "./stories";

const { Default, Empty } = composeStories(stories);
const initialTimeout = { timeout: 60000 };

describe("evo-badge", () => {
  describe("testing", () => {
    test("renders the badge number with a default a11y label", async () => {
      await render(Default);
      expect(screen.getByText("5")).toBeTruthy();
      expect(screen.getByLabelText("5 notifications")).toBeTruthy();
    });

    test("renders an empty badge with the default a11y label", async () => {
      await render(Empty);
      expect(screen.getByLabelText("notification")).toBeTruthy();
    });
  });

  testPage((getPage) => {
    test("docs come from Input JSDoc, inherited attributes stay out", async () => {
      const page = await getPage();
      await page.goto(`/?path=/story/${Default.id}`);
      await page.getByText("Controls", { exact: true }).click(initialTimeout);
      const panel = page.locator("#storybook-panel-root");

      await expect(
        panel.getByText("Used as the number to be placed in the badge."),
      ).toBeVisible(initialTimeout);
      await expect(panel.getByText("The badge type.")).toBeVisible();
      await expect(
        panel.getByText("English default to be overridden"),
      ).toBeVisible();
      await expect(panel.getByText(/native HTML/)).toBeVisible();

      // `aria-busy` stands in for the Marko.HTML.Span attributes, none of
      // which are listed individually.
      await expect(panel.getByText("aria-busy")).not.toBeVisible();

      // The native `hidden` attribute's lib JSDoc must not leak into ours.
      await expect(
        panel.getByText("Visually hides the badge without removing it."),
      ).toBeVisible();
      await expect(
        panel.getByText(/hidden from rendering|html\.spec\.whatwg\.org/),
      ).not.toBeVisible();
    });
  });
});
