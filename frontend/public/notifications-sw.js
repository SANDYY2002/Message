// Notification display/click handling only: no request caching or background push subscription.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { userId, conversationId, clientUrl } = event.notification.data || {};
  if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(conversationId))
    return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const target = windows.find((c) => c.url === clientUrl) || windows[0];
      if (target) {
        await target.focus();
        target.postMessage({
          type: "message-notification-click",
          userId,
          conversationId,
        });
      } else {
        const url = new URL("/", self.location.origin);
        url.searchParams.set("notificationUser", String(userId));
        url.searchParams.set("conversation", String(conversationId));
        await self.clients.openWindow(url.href);
      }
    })(),
  );
});
