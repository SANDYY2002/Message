import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
test("anonymous confessions and authenticator-protected moderation", async ({
  page,
}) => {
  const name = "community_" + Date.now().toString().slice(-8),
    text = "Something kind " + Date.now();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", async (d) => {
    errors.push("Unexpected browser dialog");
    await d.dismiss();
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Your name" }).fill(name);
  await page.getByRole("textbox", { name: "Username" }).fill(name);
  await page.getByLabel("Password", { exact: true }).fill("safe-password-123");
  await page.locator(".auth-submit").click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confessions", exact: true }).click();
  await expect(
    page.getByText("Superadmins can identify", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Your anonymous confession").fill(text);
  await page.getByRole("button", { name: "Publish anonymously" }).click();
  const card = page.locator("article.community-card").filter({ hasText: text });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "0 Like", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "1 Liked", exact: true }),
  ).toBeVisible();
  await card.getByRole("button", { name: "Read and write comments" }).click();
  await card
    .getByRole("textbox", { name: "Confession comment" })
    .fill("An anonymous thought");
  await card.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(card.locator(".confession-comment")).toContainText(
    "An anonymous thought",
  );
  await card.getByLabel("Comment anonymously").uncheck();
  await card
    .getByRole("textbox", { name: "Confession comment" })
    .fill("A named thought");
  await card.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(
    card.locator(".confession-comment").filter({ hasText: "A named thought" }),
  ).toContainText("@" + name);
  await page.screenshot({
    path: "test-results/confessions-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/confessions-mobile.png",
    fullPage: true,
  });
  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete confession?" })
    .getByRole("button", { name: "Delete confession", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  await page.getByLabel("Your anonymous confession").fill("fuck this day");
  await page.getByRole("button", { name: "Publish anonymously" }).click();
  await expect(
    page.getByText("Submitted for admin review.", { exact: false }),
  ).toBeVisible();
  process.env.ADMIN_ENCRYPTION_KEY = "ef".repeat(32);
  const { query, pool } = await import("../backend/src/db.js");
  const { encrypt, totp } = await import("../backend/src/admin-crypto.js");
  const secret = randomBytes(20);
  try {
    const [u] = await query("SELECT id FROM users WHERE username=?", [name]);
    await query("INSERT INTO superadmins(user_id,secret) VALUES(?,?)", [
      u.id,
      encrypt(secret),
    ]);
  } finally {
    await pool.end();
  }
  await page.reload();
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .click();
  await page.getByLabel("Password", { exact: true }).fill("safe-password-123");
  await page
    .getByLabel("Authenticator code")
    .fill(totp(secret, Math.floor(Date.now() / 30000)));
  await page.getByRole("button", { name: "Unlock admin access" }).click();
  await expect(
    page.getByRole("button", { name: "Lock admin", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "moderation", exact: true }).click();
  const review = page
    .locator("article.community-card")
    .filter({ hasText: "@" + name });
  await expect(review).toContainText("fuck this day");
  await review.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(review).toHaveCount(0);
  await page.screenshot({
    path: "test-results/admin-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Lock admin", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Verify it’s you" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
