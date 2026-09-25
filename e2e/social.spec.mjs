import { test, expect } from "@playwright/test";
test("publish from both tabs, follow, engage, review requests and block", async ({
  browser,
}) => {
  const ac = await browser.newContext({ baseURL: "http://localhost:5173" }),
    bc = await browser.newContext({ baseURL: "http://localhost:5173" });
  const a = await ac.newPage(),
    b = await bc.newPage(),
    suffix = Date.now().toString().slice(-8),
    an = `sociala_${suffix}`,
    bn = `socialb_${suffix}`;
  const errors = [];
  a.on("pageerror", (e) => errors.push(e.message));
  b.on("pageerror", (e) => errors.push(e.message));
  async function register(page, name) {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await page.getByRole("textbox", { name: "Your name" }).fill(name);
    await page.getByRole("textbox", { name: "Username" }).fill(name);
    await page
      .getByLabel("Password", { exact: true })
      .fill("safe-password-123");
    await page.locator(".auth-submit").click();
    await expect(
      page.getByRole("heading", { name: "Home", exact: true }),
    ).toBeVisible();
  }
  try {
    await register(a, an);
    await register(b, bn);
    await a
      .getByRole("textbox", { name: "Write a post" })
      .fill(`Home post ${suffix}`);
    await a.getByRole("button", { name: "Publish post" }).click();
    await expect(
      a.locator(".post-card").filter({ hasText: `Home post ${suffix}` }),
    ).toBeVisible();
    await a.getByRole("button", { name: "Posts", exact: true }).click();
    await a
      .getByRole("textbox", { name: "Write a post" })
      .fill(`Posts tab ${suffix}`);
    await a.getByRole("button", { name: "Publish post" }).click();
    const card = b
      .locator(".post-card")
      .filter({ hasText: `Home post ${suffix}` });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Follow", exact: true }).click();
    await expect(
      card.getByRole("button", { name: "Unfollow", exact: true }),
    ).toBeVisible();
    await card.getByRole("button", { name: "Like post", exact: true }).click();
    await expect(
      card.getByRole("button", { name: "Like post", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await card.getByRole("button", { name: "Comments", exact: true }).click();
    await card
      .getByRole("textbox", { name: "Write a comment" })
      .fill("Happy to be here");
    await card.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(card.locator(".comment")).toContainText("Happy to be here");
    await card.getByRole("button", { name: "Save post", exact: true }).click();
    await expect(
      card.getByRole("button", { name: "Save post", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await card.getByRole("button", { name: "Repost", exact: true }).click();
    await a.bringToFront();
    await a.getByRole("button", { name: "Activity", exact: true }).click();
    await expect(a.locator(".activity-card")).toHaveCount(4);
    for (const item of await a.locator(".activity-card").all()) {
      await item.scrollIntoViewIfNeeded();
      await expect(item).not.toHaveClass(/unread/);
    }
    await a
      .locator(".activity-card")
      .first()
      .getByRole("button", { name: `View @${bn} profile` })
      .click();
    const profile = a.getByRole("region", { name: "User profile" });
    await expect(
      profile.getByRole("button", { name: "Follow Back", exact: true }),
    ).toBeVisible();
    await profile
      .getByRole("button", { name: "Follow Back", exact: true })
      .click();
    await expect(
      profile.getByRole("button", { name: "Unfollow", exact: true }),
    ).toBeVisible();
    await profile
      .getByRole("button", { name: "Unfollow", exact: true })
      .click();
    await expect(
      profile.getByRole("button", { name: "Follow Back", exact: true }),
    ).toBeVisible();
    await a.getByRole("button", { name: "Settings", exact: true }).click();
    await a
      .getByLabel("Bio", { exact: true })
      .fill("A colourful corner of the community");
    await a.getByRole("button", { name: "Save bio", exact: true }).click();
    await expect(a.getByText("Bio updated.", { exact: true })).toBeVisible();
    await a
      .getByRole("combobox", { name: "Theme", exact: true })
      .selectOption("coloured");
    await a
      .getByRole("button", { name: "Close settings", exact: true })
      .click();
    await a.reload();
    await expect(a.locator("html")).toHaveAttribute("data-theme", "coloured");
    await a.getByRole("button", { name: "Your profile", exact: true }).click();
    await expect(a.getByRole("region", { name: "User profile" })).toContainText(
      "2 Posts",
    );
    await a.screenshot({ path: "test-results/coloured-profile.png" });

    await a.getByRole("button", { name: "Home", exact: true }).click();
    await a.getByRole("textbox", { name: "Find people" }).fill(bn);
    const person = a.locator(".person-card").filter({ hasText: bn });
    await person.getByRole("button", { name: "Message", exact: true }).click();
    await a
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("An introduction");
    await a.getByRole("button", { name: "Send message", exact: true }).click();
    await b.getByRole("button", { name: "Conversations", exact: true }).click();
    await expect(
      b.locator(".conversation").filter({ hasText: an }),
    ).toHaveCount(0);
    await b.getByRole("button", { name: /Message Requests/ }).click();
    await b.locator(".conversation").filter({ hasText: an }).click();
    await expect(
      b.getByRole("button", { name: "Accept request", exact: true }),
    ).toBeVisible();
    await expect(
      b.getByRole("button", { name: "Voice call", exact: true }),
    ).toHaveCount(0);
    await b
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Replying accepts");
    await b.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(
      a.locator(".message-bubble").filter({ hasText: "Replying accepts" }),
    ).toBeVisible();
    await expect(
      a.getByRole("button", { name: "Voice call", exact: true }),
    ).toBeVisible();
    b.on("dialog", async (d) => {
      errors.push("Unexpected browser dialog");
      await d.dismiss();
    });
    await b.getByRole("button", { name: "Block user", exact: true }).click();
    const confirmation = b.getByRole("dialog", {
      name: `Block @${an}?`,
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    await expect(
      confirmation.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeFocused();
    await b.keyboard.press("Escape");
    await expect(confirmation).not.toBeVisible();
    await expect(
      b.getByRole("button", { name: "Block user", exact: true }),
    ).toBeFocused();
    await b.getByRole("button", { name: "Block user", exact: true }).click();
    await b.screenshot({ path: "test-results/confirmation-desktop.png" });
    await b.setViewportSize({ width: 390, height: 844 });
    await expect(confirmation).toBeVisible();
    expect(
      await confirmation.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await b.screenshot({ path: "test-results/confirmation-mobile.png" });
    await confirmation
      .getByRole("button", { name: "Block user", exact: true })
      .click();
    await b.setViewportSize({ width: 1280, height: 720 });

    await expect(a.getByRole("heading", { name: bn, exact: true })).toHaveCount(
      0,
    );
    await b.getByRole("button", { name: "Home", exact: true }).click();
    await expect(
      b.locator(".post-card").filter({ hasText: `Home post ${suffix}` }),
    ).toHaveCount(0);
    await b.getByRole("textbox", { name: "Find people" }).fill(an);
    await expect(b.locator(".person-card").filter({ hasText: an })).toHaveCount(
      0,
    );
    await a.getByRole("button", { name: "Home", exact: true }).click();
    await a.screenshot({ path: "test-results/social-home.png" });
    await a.setViewportSize({ width: 390, height: 844 });
    await a.screenshot({ path: "test-results/social-mobile.png" });
    expect(errors).toEqual([]);
  } finally {
    await ac.close();
    await bc.close();
  }
});
