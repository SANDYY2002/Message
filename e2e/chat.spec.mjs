import { test, expect } from "@playwright/test";
import { video } from "../backend/test/video-fixture.js";

test("two people can sign up, chat, share media, reconnect, and use mobile dark mode", async ({
  browser,
}) => {
  const aliceContext = await browser.newContext({
    baseURL: "http://localhost:5173",
    viewport: { width: 1440, height: 960 },
  });
  const bobContext = await browser.newContext({
    baseURL: "http://localhost:5173",
    viewport: { width: 1280, height: 900 },
  });
  const alice = await aliceContext.newPage(),
    bob = await bobContext.newPage();
  const errors = [];
  alice.on("pageerror", (e) => errors.push(e.message));
  bob.on("pageerror", (e) => errors.push(e.message));
  const suffix = Date.now().toString().slice(-8),
    aname = `alice_${suffix}`,
    bname = `bob_${suffix}`;
  async function register(page, username, displayName) {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await page.getByRole("textbox", { name: "Your name" }).fill(displayName);
    await page.getByRole("textbox", { name: "Username" }).fill(username);
    await page
      .getByLabel("Password", { exact: true })
      .fill("safe-password-123");
    await page.locator(".auth-submit").click();
    await expect(
      page.getByRole("heading", { name: /Good conversations/ }),
    ).toBeVisible();
  }
  await alice.goto("/");
  await expect(
    alice.getByRole("heading", { name: "Good to see you." }),
  ).toBeVisible();
  await alice.screenshot({
    path: "test-results/auth-desktop.png",
    fullPage: true,
  });
  await register(alice, aname, "Alice");
  await register(bob, bname, "Bob");
  await alice
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await alice.getByRole("textbox", { name: "Search people" }).fill(bname);
  await alice
    .getByRole("button", { name: new RegExp("Bob.*" + bname) })
    .click();
  await expect(
    alice.getByRole("heading", { name: "Bob", exact: true }),
  ).toBeVisible();
  await expect(alice.getByText("Connected", { exact: true })).toBeVisible();
  await alice
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Hello from Alice 👋");
  await alice.getByRole("button", { name: "Send message" }).click();
  await bob
    .getByRole("button", { name: new RegExp("Alice.*Hello from Alice") })
    .click();
  await expect(
    bob
      .locator(".message-bubble")
      .getByText("Hello from Alice 👋", { exact: true }),
  ).toBeVisible();
  await expect(alice.getByLabel("Read", { exact: true })).toBeVisible();
  await bob
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Nice to see you here.");
  await bob.getByRole("button", { name: "Send message" }).click();
  await expect(
    alice
      .locator(".message-bubble")
      .getByText("Nice to see you here.", { exact: true }),
  ).toBeVisible();
  // Drafts survive a click on the same conversation and returning from the mobile inbox.
  await alice
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("An unsent thought");
  await alice.locator(".conversation").first().click();
  await expect(
    alice.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("An unsent thought");
  await alice
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("A small photo");
  await alice.locator("input[type=file]").setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await alice.getByRole("button", { name: "Send message" }).click();
  await expect(
    bob.getByRole("img", { name: "photo.png", exact: true }),
  ).toBeVisible();
  await alice
    .locator("input[type=file]")
    .setInputFiles({ name: "clip.mp4", mimeType: "video/mp4", buffer: video });
  await alice.getByRole("button", { name: "Send message" }).click();
  await expect(bob.locator("video")).toBeVisible();
  await expect
    .poll(() => bob.locator("video").evaluate((v) => v.readyState))
    .toBeGreaterThan(0);
  await bob.locator("video").evaluate((v) => v.play());
  await alice.screenshot({ path: "test-results/chat-desktop.png" });
  await alice
    .getByRole("button", { name: "Theme: system. Change theme" })
    .last()
    .click();
  await alice
    .getByRole("button", { name: "Theme: light. Change theme" })
    .last()
    .click();
  await expect(alice.locator("html")).toHaveAttribute("data-theme", "dark");
  await alice.screenshot({ path: "test-results/chat-dark.png" });
  await alice.setViewportSize({ width: 390, height: 844 });
  await alice
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Mobile draft");
  await alice.getByRole("button", { name: "Back to conversations" }).click();
  await alice.locator(".conversation").first().click();
  await expect(
    alice.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Mobile draft");
  expect(
    await alice.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await alice.screenshot({ path: "test-results/chat-mobile.png" });
  await alice.reload();
  await alice.locator(".conversation").first().click();
  await expect(
    alice
      .locator(".message-bubble")
      .getByText("Hello from Alice 👋", { exact: true }),
  ).toBeVisible();
  await expect(alice.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(errors).toEqual([]);
  await aliceContext.close();
  await bobContext.close();
});
