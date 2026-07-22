import { composeStories, setContentShell } from "@storybook/marko";
import contentShell from "@storybook/marko/content-shell.marko";
import { expect } from "playwright/test";

import { testPage } from "../../test-page";
import * as stories from "./stories";

setContentShell(contentShell);

const { WithContent, WithAttrTagContent, NoContent, Decorated } =
  composeStories(stories);
const initialTimeout = { timeout: 60000 };

describe("tags-content", () => {
  describe("testing", () => {
    let container: HTMLElement;
    beforeEach(() => {
      container = document.body.appendChild(document.createElement("div"));
    });
    afterEach(() => container.remove());

    test("renders body content from the content arg", () => {
      WithContent.mount({}, container);
      expect(container.textContent).toContain("Hello World");
      expect(container.querySelector("section em")?.textContent).toBe(
        "emphasized",
      );
    });

    test("renders attr tag content", () => {
      WithAttrTagContent.mount({}, container);
      expect(container.querySelector("h1")?.textContent).toBe("A header");
      expect(container.querySelector("header b")?.textContent).toBe("markup");
      expect(container.querySelector("section em")?.textContent).toBe(
        "emphasized",
      );
    });

    test("renders without content when the arg is unset", () => {
      NoContent.mount({}, container);
      expect(container.textContent).toContain("Hello Marko");
      expect(container.querySelector("section")?.textContent).toBe("");
      expect(container.querySelector("header")).toBeNull();
    });

    test("applies decorators to tags api stories", () => {
      Decorated.mount({}, container);
      const border = container.querySelector(".border");
      expect(border?.textContent).toContain("Hello Framed");
      expect(border?.querySelector("b")?.textContent).toBe("bold");
    });
  });

  describe(WithContent.storyName, () => {
    testPage((getPage) => {
      beforeEach(async () => {
        const page = await getPage();
        await page.goto(`/?path=/story/${WithContent.id}`);
      });

      test("renders initial body content", async () => {
        const page = await getPage();
        const frame = page.frameLocator("#storybook-preview-iframe");
        await expect(frame.getByText("Hello World")).toBeVisible(
          initialTimeout,
        );
        await expect(frame.locator("section em")).toHaveText(
          "emphasized",
          initialTimeout,
        );
      });

      test("updates body content from the controls addon without remounting", async () => {
        const page = await getPage();
        const frame = page.frameLocator("#storybook-preview-iframe");
        const counter = frame.getByRole("button", { name: /count/ });
        await counter.click(initialTimeout);
        await expect(counter).toHaveText("count 1", initialTimeout);

        await page.getByText("Controls", { exact: true }).click(initialTimeout);
        await page.locator('[name="content"]').fill("<strong>changed</strong>");
        await expect(frame.locator("section strong")).toHaveText(
          "changed",
          initialTimeout,
        );

        await page.locator('[name="name"]').fill("Updated");
        await expect(frame.getByText("Hello Updated")).toBeVisible(
          initialTimeout,
        );

        // Component state survives content edits: args update in place.
        await expect(counter).toHaveText("count 1", initialTimeout);
      });
    });
  });

  describe(WithAttrTagContent.storyName, () => {
    testPage((getPage) => {
      beforeEach(async () => {
        const page = await getPage();
        await page.goto(`/?path=/story/${WithAttrTagContent.id}`);
      });

      test("renders and updates attr tag content", async () => {
        const page = await getPage();
        const frame = page.frameLocator("#storybook-preview-iframe");
        await expect(frame.locator("header b")).toHaveText(
          "markup",
          initialTimeout,
        );

        await page.getByText("Controls", { exact: true }).click(initialTimeout);
        await page
          .locator('[name="@header > content"]')
          .fill("now <i>italic</i>");
        await expect(frame.locator("header i")).toHaveText(
          "italic",
          initialTimeout,
        );
        await expect(frame.locator("header h1")).toHaveText(
          "A header",
          initialTimeout,
        );
      });
    });
  });

  describe(NoContent.storyName, () => {
    testPage((getPage) => {
      beforeEach(async () => {
        const page = await getPage();
        await page.goto(`/?path=/story/${NoContent.id}`);
      });

      test("mounts without the shell until content is set", async () => {
        const page = await getPage();
        const frame = page.frameLocator("#storybook-preview-iframe");
        await expect(frame.getByText("Hello Marko")).toBeVisible(
          initialTimeout,
        );
        await expect(frame.locator("section")).toBeEmpty();
      });

      test("remounts into the shell when content is first set", async () => {
        const page = await getPage();
        const frame = page.frameLocator("#storybook-preview-iframe");
        await expect(frame.getByText("Hello Marko")).toBeVisible(
          initialTimeout,
        );
        await page.getByText("Controls", { exact: true }).click(initialTimeout);
        await page
          .getByRole("button", { name: "Set string" })
          .first()
          .click(initialTimeout);
        await page.locator('[name="content"]').fill("now <em>present</em>");
        await expect(frame.locator("section em")).toHaveText(
          "present",
          initialTimeout,
        );
      });
    });
  });

  describe(Decorated.storyName, () => {
    testPage((getPage) => {
      beforeEach(async () => {
        const page = await getPage();
        await page.goto(`/?path=/story/${Decorated.id}`);
      });

      test("wraps the story with the decorator template", async () => {
        const page = await getPage();
        const frame = page.frameLocator("#storybook-preview-iframe");
        await expect(frame.locator(".border b")).toHaveText(
          "bold",
          initialTimeout,
        );
        await expect(
          frame.locator(".border").getByText("Hello Framed"),
        ).toBeVisible(initialTimeout);
      });
    });
  });
});
