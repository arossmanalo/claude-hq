import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("the building lists every project floor in its directory", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Connected")).toBeAttached();
  const directory = page.getByRole("heading", { name: "Directory" }).locator("..");
  await expect(directory.getByRole("button", { name: /shop/ })).toBeVisible();
  await expect(page.locator("canvas")).toBeAttached();
  await expectNoHorizontalScroll(page);
});

test("opening a floor shows one room per agent with its state and model", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^shop/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Cart badge" })).toBeVisible();

  const rooms = page.getByRole("heading", { name: "Rooms" }).locator("..");
  const coder = rooms.getByRole("button", { name: /Coder/ });
  await expect(coder).toContainText("Done");
  await expect(coder).toContainText("Sonnet 5.5");
  await expect(rooms.getByRole("button", { name: /Designer/ })).toContainText("Free desk");

  await expect(page.getByText("Add a cart badge and test it")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("the filing cabinet lists the project's sessions", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^shop/ }).click();
  await page.getByRole("button", { name: /Open filing cabinet/ }).click();
  await expect(page.getByRole("heading", { name: "Filing cabinet" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Cart badge/ })).toBeVisible();
});

test("an archived session can be continued from the composer", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^shop/ }).click();
  const box = page.getByRole("textbox", { name: "Message to the router" });
  await expect(box).toBeEnabled();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await box.fill("Add a test");
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
});

test("an unknown office address offers a way back", async ({ page }) => {
  await page.goto("/#/office/nowhere");
  await expect(page.getByText("There's no project at this address")).toBeVisible();
  await page.getByRole("button", { name: "Back to the building" }).click();
  await expect(page.getByRole("heading", { name: "Directory" })).toBeVisible();
});

test("the open-office form rejects a relative path", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Project folder").fill("my-app");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByText("Enter the folder's full path")).toBeVisible();
});
