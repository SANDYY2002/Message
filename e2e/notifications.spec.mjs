import { test, expect } from "@playwright/test";

// Full Chromium implements notification permissions; the minimal headless shell does not.
test.use({ channel: "chromium" });

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
  await bContext.grantPermissions(["notifications"], {
    origin: "http://localhost:5173",
  });
  const a = await aContext.newPage(),
    b = await bContext.newPage();
  const errors = [];
  a.on("pageerror", (e) => errors.push(e.message));
  b.on("pageerror", (e) => errors.push(e.message));
  // Model foreground/background deterministically; exercise the real notification service worker.
  await b.addInitScript(() => {
    window.__notificationFocus = true;
    window.__notificationRequests = [];
    window.__soundStarts = 0;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.__soundStarts++;
      return start.apply(this, args);
    };
    // Call the real browser API while observing requests: headless CI may not
    // retain OS notifications in getNotifications(), even when display succeeds.
    const show = ServiceWorkerRegistration.prototype.showNotification;
    ServiceWorkerRegistration.prototype.showNotification = async function (
      title,
      options,
    ) {
      const entry = { title, ...options, completed: false };
      window.__notificationRequests.push(entry);
      try {
        await show.call(this, title, options);
        entry.completed = true;
      } catch (error) {
        entry.error = error.message;
        throw error;
      }
    };
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
    await page
      .getByRole("button", { name: "Conversations", exact: true })
      .click();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  }
  async function openSettings() {
    await b.getByRole("button", { name: /^Settings/ }).click();
    await b.getByRole("tab", { name: "Notifications & sound" }).click();
  }
  async function closeSettings() {
    await b.getByRole("button", { name: "Close settings" }).click();
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
  const requests = () => b.evaluate(() => window.__notificationRequests);
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
    expect(await b.evaluate(() => Notification.permission)).toBe("granted");
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
    expect(await requests()).toHaveLength(0);
    expect(await b.evaluate(() => window.__soundStarts)).toBe(0);
    await openSettings();
    await b.getByRole("button", { name: "Enable sound", exact: true }).click();
    await expect(
      b.getByRole("button", { name: "Sound on", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => b.evaluate(() => window.__soundStarts)).toBe(2);
    await b
      .getByRole("button", { name: "Enable notifications", exact: true })
      .click();
    await expect(
      b.getByRole("button", { name: "Disable notifications", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await closeSettings();
    await b.evaluate(() => {
      window.__notificationFocus = false;
    });
    // Accept the first message request before testing subsequent message alerts.
    const cid = await b.evaluate(async () => {
      const d = await (await fetch("/api/conversations")).json();
      return d.conversations.find((c) => c.incomingRequest).id;
    });
    await b.evaluate(async (cid) => {
      await fetch(`/api/conversations/${cid}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    }, cid);
    await send("Secret content must never appear in system banners");
    await expect
      .poll(async () => await requests())
      .toMatchObject([{ completed: true }]);
    await expect.poll(() => b.evaluate(() => window.__soundStarts)).toBe(4);
    const [notice] = await requests();
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
    expect(await requests()).toHaveLength(1);
    expect(await b.evaluate(() => window.__soundStarts)).toBe(4);
    await expect(
      b.getByRole("button", { name: "New message · Open conversation" }),
    ).toHaveCount(0);
    await openSettings();
    await b
      .getByRole("button", { name: "Disable notifications", exact: true })
      .click();
    await expect(
      b.getByRole("button", { name: "Enable notifications", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await b.evaluate(() => {
      window.__notificationFocus = false;
    });
    await b.getByRole("button", { name: "Sound on", exact: true }).click();
    await closeSettings();
    await send("Disabled browser alerts");
    await expect(
      b
        .locator(".message-bubble")
        .getByText("Disabled browser alerts", { exact: true }),
    ).toBeVisible();
    expect(await requests()).toHaveLength(1);
    expect(await b.evaluate(() => window.__soundStarts)).toBe(4);
    await b.reload();
    await openSettings();
    await expect(
      b.getByRole("button", { name: "Enable sound", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(errors).toEqual([]);
  } catch (error) {
    console.log(
      "Notification diagnostics:",
      await b
        .evaluate(() => ({
          permission: Notification.permission,
          focused: document.hasFocus(),
          requests: window.__notificationRequests,
          statuses: [...document.querySelectorAll('[role="status"]')].map(
            (n) => n.textContent,
          ),
        }))
        .catch(() => ({})),
    );
    throw error;
  } finally {
    await aContext.close();
    await bContext.close();
  }
});
