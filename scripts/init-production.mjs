import { mkdir, writeFile, copyFile, constants } from "node:fs/promises";
import { randomBytes } from "node:crypto";
await mkdir("secrets", { recursive: true, mode: 0o700 });
for (const name of ["db_password", "db_root_password"]) {
  try {
    await writeFile(`secrets/${name}`, randomBytes(32).toString("hex") + "\n", {
      flag: "wx",
      mode: 0o644,
    });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
}
// Empty until a real TURN relay is configured. Never overwrite existing secrets.
try {
  await writeFile("secrets/turn_secret", "", { flag: "wx", mode: 0o644 });
} catch (e) {
  if (e.code !== "EEXIST") throw e;
}
try {
  await copyFile("deploy/env.example", ".env", constants.COPYFILE_EXCL);
} catch (e) {
  if (e.code !== "EEXIST") throw e;
}
console.log(
  "Production files prepared. Set APP_DOMAIN in .env; configure TURN_URLS and secrets/turn_secret for calls. Existing files were preserved.",
);
