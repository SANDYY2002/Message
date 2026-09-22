import { test, expect } from "@playwright/test";
import sharp from "sharp";
test("profile settings save a square avatar and username, then change password", async ({
  page,
}) => {
  const username = `profile_${Date.now().toString().slice(-8)}`;
  await page.goto("/");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Your name" }).fill("Profile tester");
  await page.getByRole("textbox", { name: "Username" }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill("safe-password-123");
  await page.locator(".auth-submit").click();
  await page.getByRole("button", { name: /^Settings/ }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog
    .getByRole("button", { name: "Use fox avatar", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Use fox avatar", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".profile-identity-avatar img")).toHaveAttribute(
    "src",
    "/avatars/fox.svg",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "test-results/profile-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: "test-results/profile-desktop.png" });
  const buffer = await sharp({
    create: { width: 400, height: 200, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  await dialog
    .getByLabel("Upload profile image")
    .setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer });
  await dialog.getByRole("button", { name: "Save uploaded avatar" }).click();
  await expect(
    dialog.getByRole("button", { name: "Save uploaded avatar" }),
  ).toHaveCount(0);
  await expect(dialog.getByAltText("Square avatar preview")).toHaveAttribute(
    "src",
    /\/api\/avatars\//,
  );
  await dialog.getByLabel("Username", { exact: true }).fill(`new_${username}`);
  await dialog.getByRole("button", { name: "Save username" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Username updated.");
  await dialog.getByRole("button", { name: "Close settings" }).click();
  await page.reload();
  await expect(page.locator(".profile-open")).toContainText(`@new_${username}`);
  await page.getByRole("button", { name: /^Settings/ }).click();
  await dialog.getByLabel("Current password", { exact: true }).fill("wrong");
  await dialog
    .getByLabel("New password", { exact: true })
    .fill("changed-password-123");
  await dialog
    .getByLabel("Confirm new password", { exact: true })
    .fill("changed-password-123");
  await dialog
    .getByRole("button", { name: "Change password and sign out" })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Current password is incorrect.",
  );
  await dialog
    .getByLabel("Current password", { exact: true })
    .fill("safe-password-123");
  await dialog
    .getByRole("button", { name: "Change password and sign out" })
    .click();
  await expect(page.locator(".auth-submit")).toBeVisible();
  await page.getByRole("textbox", { name: "Username" }).fill(`new_${username}`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("changed-password-123");
  await page.locator(".auth-submit").click();
  await expect(page.locator(".profile-open")).toContainText(`@new_${username}`);
});
