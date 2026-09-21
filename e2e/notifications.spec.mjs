import { test, expect } from "@playwright/test";

test("message notifications are opt-in, private, actionable, and disabled on request", async ({
  browser,
}) => {
  const aContext = await browser.newContext({
    baseURL: "http://localhost:5173",
    permissions: ["notifications"],
  });
  const bContext = await browser.newContext({
    baseURL: "http://localhost:5173",
    permissions: ["notifications"],
  });
  const a = await aContext.newPage(),
    b = await bContext.newPage();
  const errors = [];
  a.on("pageerror", (e) => errors.push(e.message));
  b.on("pageerror", (e) => errors.push(e.message));
  // Model foreground/background deterministically; exercise the real notification service worker.
  await b.addInitScript(() => {
    window.__notificationFocus = true;
    Object.defineProperty(document, "hasFocus", {
      value: () => window.__notificationFocus,
    });
  });
  const suffix = Date.now().toString().slice(-8);
  async function signup(page, name) {
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
  const notifications = () =>
    b.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration("/");
      return r
        ? (await r.getNotifications()).map((n) => ({
            title: n.title,
            body: n.body,
            data: n.data,
            tag: n.tag,
          }))
        : [];
    });
  async function send(text) {
    await a.getByRole("textbox", { name: "Message", exact: true }).fill(text);
    await a.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(
      a.locator(".message-bubble").getByText(text, { exact: true }),
    ).toBeVisible();
  }
  try {
    await signup(a, "notifyalice");
    await signup(b, "notifybob");
    await a
      .getByRole("button", { name: "New conversation", exact: true })
      .first()
      .click();
    await a
      .getByRole("textbox", { name: "Search people" })
      .fill(`notifybob_${suffix}`);
    await a
      .getByRole("button", {
        name: new RegExp(`notifybob.*notifybob_${suffix}`),
      })
      .click();
    await send("First private message");
    await expect(
      b.getByRole("button", { name: "New message · Open conversation" }),
    ).toBeVisible();
    await expect(b).toHaveTitle("(1) Message");
    expect(await notifications()).toHaveLength(0);
    await b
      .getByRole("button", { name: "Enable notifications", exact: true })
      .click();
    await expect(
      b.getByRole("button", { name: "Disable notifications", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await b.evaluate(() => {
      window.__notificationFocus = false;
    });
    await send("Secret content must never appear in system banners");
    await expect.poll(async () => (await notifications()).length).toBe(1);
    const [notice] = await notifications();
    expect(notice.title).toBe("New message");
    expect(notice.body).toBe("You have a new message in Message.");
    expect(JSON.stringify(notice)).not.toContain("Secret content");
    await b.evaluate((data) => {
      window.__notificationFocus = true;
      navigator.serviceWorker.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "message-notification-click", ...data },
        }),
      );
    }, notice.data);
    await expect(
      b.getByRole("heading", { name: "notifyalice", exact: true }),
    ).toBeVisible();
    await expect.poll(async () => (await notifications()).length).toBe(0);
    await expect(b).toHaveTitle("Message — A little closer");
    await send("Already reading this conversation");
    await expect(
      b
        .locator(".message-bubble")
        .getByText("Already reading this conversation", { exact: true }),
    ).toBeVisible();
    expect(await notifications()).toHaveLength(0);
    await expect(
      b.getByRole("button", { name: "New message · Open conversation" }),
    ).toHaveCount(0);
    await b
      .getByRole("button", { name: "Disable notifications", exact: true })
      .click();
    await expect(
      b.getByRole("button", { name: "Enable notifications", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await b.evaluate(() => {
      window.__notificationFocus = false;
    });
    await send("Disabled browser alerts");
    await expect(
      b
        .locator(".message-bubble")
        .getByText("Disabled browser alerts", { exact: true }),
    ).toBeVisible();
    expect(await notifications()).toHaveLength(0);
    expect(errors).toEqual([]);
  } finally {
    await aContext.close();
    await bContext.close();
  }
});
