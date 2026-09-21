import { test, expect } from "@playwright/test";
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

test("two users connect video and voice, mute, hang up, and see call history", async ({
  browser,
}) => {
  const contexts = await Promise.all(
    [1, 2].map(() =>
      browser.newContext({
        baseURL: "http://localhost:5173",
        permissions: ["camera", "microphone"],
      }),
    ),
  );
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
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
  try {
    await signup(a, "callalice");
    await signup(b, "callbob");
    await a
      .getByRole("button", { name: "New conversation", exact: true })
      .first()
      .click();
    await a
      .getByRole("textbox", { name: "Search people" })
      .fill(`callbob_${suffix}`);
    await a
      .getByRole("button", { name: new RegExp(`callbob.*callbob_${suffix}`) })
      .click();
    for (const kind of ["Video", "Voice"]) {
      await a
        .getByRole("button", { name: `${kind} call`, exact: true })
        .click();
      const ad = a.getByRole("dialog", { name: "Call", exact: true }),
        bd = b.getByRole("dialog", { name: "Call", exact: true });
      await expect(
        bd.getByText("Incoming call", { exact: true }),
      ).toBeVisible();
      await bd
        .getByRole("button", { name: "Accept call", exact: true })
        .click();
      await expect(ad.getByText("Connected", { exact: true })).toBeVisible({
        timeout: 20000,
      });
      await expect(bd.getByText("Connected", { exact: true })).toBeVisible({
        timeout: 20000,
      });
      if (kind === "Video") {
        await expect
          .poll(() =>
            b
              .locator('video[aria-label="Remote video"]')
              .evaluate((v) => v.videoWidth),
          )
          .toBeGreaterThan(0);
        await ad.getByRole("button", { name: "Turn camera off" }).click();
        await expect(
          ad.getByRole("button", { name: "Turn camera on" }),
        ).toBeVisible();
      }
      await ad
        .getByRole("button", { name: "Mute microphone", exact: true })
        .click();
      await expect(
        ad.getByRole("button", { name: "Unmute microphone", exact: true }),
      ).toBeVisible();
      await a.screenshot({
        path: `test-results/${kind.toLowerCase()}-call.png`,
      });
      await bd.getByRole("button", { name: "End call", exact: true }).click();
      await expect(ad).not.toBeVisible();
      await expect(bd).not.toBeVisible();
      await expect
        .poll(() => a.locator('video[aria-label="Your camera"]').count())
        .toBe(0);
      // The server deliberately rate-limits repeated invitations from the same user.
      await a.waitForTimeout(5100);
    }
    await a.getByRole("button", { name: "Call history", exact: true }).click();
    const history = a.getByRole("dialog", {
      name: "Call history",
      exact: true,
    });
    await expect(history.locator("li")).toHaveCount(2);
    await expect(history.locator("li").first()).toContainText("ended");
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
