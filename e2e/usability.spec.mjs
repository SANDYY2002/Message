import { test, expect } from "@playwright/test";

test("password visibility and readable gateway errors preserve sign-in input", async ({
  page,
}) => {
  await page.goto("/");
  const password = page.locator('input[name="password"]');
  await page.getByRole("textbox", { name: "Username" }).fill("sample_user");
  await password.fill("a-private-password");
  await expect(password).toHaveAttribute("type", "password");
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("a-private-password");
  await page
    .getByRole("button", { name: "Hide password", exact: true })
    .click();
  await expect(password).toHaveAttribute("type", "password");
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      status: 502,
      contentType: "text/html",
      body: "<html>Bad gateway</html>",
    }),
  );
  await page.locator(".auth-submit").click();
  await expect(page.getByRole("alert")).toHaveText(
    "The server is temporarily unavailable. Please try again shortly.",
  );
  await expect(password).toHaveValue("a-private-password");
  await expect(page.locator(".auth-submit")).toBeEnabled();
  await page.unroute("**/api/auth/login");
  await page.route("**/api/auth/login", (route) => route.abort("failed"));
  await page.locator(".auth-submit").click();
  await expect(page.getByRole("alert")).toHaveText(
    "Connection lost. Check your internet connection and try again.",
  );
});
