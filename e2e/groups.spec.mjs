import { test, expect } from "@playwright/test";
test("create a group, exchange messages, show sender names and remove a member", async ({
  browser,
}) => {
  const contexts = await Promise.all(
    [1, 2, 3].map(() =>
      browser.newContext({ baseURL: "http://localhost:5173" }),
    ),
  );
  const [a, b, c] = await Promise.all(contexts.map((x) => x.newPage()));
  const suffix = Date.now().toString().slice(-8);
  async function register(page, name) {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await page.getByRole("textbox", { name: "Your name" }).fill(name);
    await page
      .getByRole("textbox", { name: "Username" })
      .fill(`${name}_${suffix}`);
    await page
      .getByLabel("Password", { exact: true })
      .fill("safe-password-123");
    await page.locator(".auth-submit").click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  }
  try {
    await register(a, "groupalice");
    await register(b, "groupbob");
    await register(c, "groupcarol");
    await a.getByRole("button", { name: "New group", exact: true }).click();
    const dialog = a.getByRole("dialog", { name: "Create group", exact: true });
    await dialog
      .getByLabel("Group name", { exact: true })
      .fill("Weekend plans");
    for (const person of ["groupbob", "groupcarol"]) {
      await dialog
        .getByRole("textbox", { name: "Search group members" })
        .fill(`${person}_${suffix}`);
      await dialog
        .locator(".group-candidates")
        .getByRole("button", { name: new RegExp(person) })
        .click();
    }
    await dialog
      .getByRole("button", { name: "Create group (3)", exact: true })
      .click();
    await expect(
      a.getByRole("heading", { name: "Weekend plans", exact: true }),
    ).toBeVisible();
    await expect(
      a.getByRole("button", { name: "Voice call", exact: true }),
    ).toHaveCount(0);
    await a
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Welcome to our group");
    await a.getByRole("button", { name: "Send message", exact: true }).click();
    await b
      .locator(".conversation")
      .filter({ hasText: "Weekend plans" })
      .click();
    await expect(
      b
        .locator(".message-bubble")
        .getByText("Welcome to our group", { exact: true }),
    ).toBeVisible();
    await expect(
      b.locator(".group-sender").getByText("groupalice", { exact: true }),
    ).toBeVisible();
    await b
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Hello everyone");
    await b.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(
      a.locator(".group-sender").getByText("groupbob", { exact: true }),
    ).toBeVisible();
    await a.getByRole("button", { name: "Group details", exact: true }).click();
    const details = a.getByRole("dialog", {
      name: "Group details",
      exact: true,
    });
    await details
      .getByRole("button", { name: "Remove groupbob", exact: true })
      .click();
    await expect(
      b.locator(".conversation").filter({ hasText: "Weekend plans" }),
    ).toHaveCount(0);
    await expect(
      b.getByRole("heading", { name: "Weekend plans", exact: true }),
    ).toHaveCount(0);
    await details
      .getByLabel("Group name", { exact: true })
      .fill("Weekend team");
    await details
      .getByRole("button", { name: "Save group name", exact: true })
      .click();
    await details
      .getByRole("button", { name: "Close group", exact: true })
      .click();
    await expect(
      a.getByRole("heading", { name: "Weekend team", exact: true }),
    ).toBeVisible();
    await c
      .locator(".conversation")
      .filter({ hasText: "Weekend team" })
      .click();
    await expect(
      c.locator(".message-bubble").getByText("Hello everyone", { exact: true }),
    ).toBeVisible();
    await a.screenshot({ path: "test-results/group-chat.png" });
  } finally {
    await Promise.all(contexts.map((x) => x.close()));
  }
});
