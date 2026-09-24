import { writeFile, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = "http://127.0.0.1:4000";
const health = await fetch(base + "/api/health");
assert.equal(health.status, 200);
const page = await fetch(base + "/");
assert.equal(page.status, 200);
assert.match(await page.text(), /<div id="root"/);
assert.ok(page.headers.get("content-security-policy"));
assert.ok(page.headers.get("strict-transport-security"));
assert.equal(page.headers.get("x-powered-by"), null);
const username = "production_smoke";
const restoring = process.env.SMOKE_RESTORE_CHECK === "1";
const response = await fetch(
  base + (restoring ? "/api/auth/login" : "/api/auth/register"),
  {
    method: "POST",
    headers: {
      Origin: process.env.PUBLIC_ORIGIN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username,
      displayName: "Production check",
      password: "smoke-password-1234",
    }),
  },
);
assert.equal(
  response.status,
  restoring ? 200 : 201,
  await response.clone().text(),
);
const cookie = response.headers.get("set-cookie");
assert.match(cookie, /HttpOnly/i);
assert.match(cookie, /Secure/i);
assert.match(cookie, /SameSite=Strict/i);
const me = await fetch(base + "/api/auth/me", {
  headers: { Cookie: cookie.split(";")[0] },
});
assert.equal((await me.json()).user.username, username);
const crossSite = await fetch(base + "/api/auth/logout", {
  method: "POST",
  headers: { Origin: "https://other.example", Cookie: cookie.split(";")[0] },
});
assert.equal(crossSite.status, 403);
console.log(
  "Production smoke passed: frontend, database, security headers, secure login and origin enforcement.",
);

const marker = "/app/backend/uploads/production-smoke.txt";
if (restoring)
  assert.equal(await readFile(marker, "utf8"), "backup verification");
else await writeFile(marker, "backup verification");
