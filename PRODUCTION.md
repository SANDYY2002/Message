# Production deployment

This repository includes a single-server deployment: Caddy terminates HTTPS and proxies the frontend, API and Socket.IO to one Node process. MySQL and uploaded files use persistent Docker volumes. Only ports 80 and 443 are published. Production cookies are Secure, HttpOnly and SameSite=Strict. The runtime runs as a non-root user with a read-only filesystem except uploads and temporary files.

## First deployment on a Linux server

You need a domain pointing to the server, inbound TCP 80/443 (UDP 443 optional), outbound internet, Docker Engine with Compose v2, and Node 24 for the one-time configuration script. No paid service is provisioned by these files.

```bash
git clone https://github.com/SANDYY2002/Message.git
cd Message
node scripts/init-production.mjs
# Edit .env: set APP_DOMAIN to your real hostname without https:// or a slash.
docker compose config --quiet
docker compose build
docker compose up -d --wait
```

The initializer generates separate random database passwords and preserves existing configuration. Secret files are inside a private directory and mounted only into services that need them. Do not commit or share secrets. MySQL reads passwords only when initializing an empty volume: changing a secret file does not rotate an existing database account password.

Visit https://YOUR_DOMAIN and https://YOUR_DOMAIN/api/health. Caddy obtains/renews certificates automatically when DNS and public port access are correct. Keep Caddy's volumes to retain certificates. If using a CDN, start with DNS-only mode: this configuration assumes exactly one trusted reverse proxy and must not expose port 4000 directly.

The migration service runs before the app starts and refuses startup on migration failure. Never use `docker compose down -v` on your production installation: it deletes data volumes. Keep one app instance; active calls, presence and rate limiting use process memory. This is not a horizontally scaled or zero-downtime deployment.

## Calling across networks

Configure a TURN relay before promising reliable voice/video calls outside your local network. Use your coturn server's public turn:/turns: addresses in TURN_URLS (comma-separated), optionally STUN_URL, and put the matching coturn static-auth-secret in secrets/turn_secret. The backend issues short-lived per-user TURN credentials; the shared secret is never sent to the browser. Both TURN_URLS and the secret must be configured together. Restart the app after changes. A TURN provider that only supplies static username/password credentials is not compatible with this configuration.

Relay TLS certificates, firewall ports and media port ranges depend on your TURN installation. Verify a call between a mobile data connection and a separate Wi-Fi network, including video, audio, mute, reconnection and hang-up. HTTPS is required for camera/microphone access outside localhost.

## Updates

Take an off-server backup first. Updates interrupt calls and briefly stop messages:

```bash
bash scripts/backup.sh
git pull --ff-only origin main
docker compose build
docker compose stop app
docker compose run --rm migrate
docker compose up -d --wait
```

Do not start the new app if migration fails. Investigate logs first. Do not roll an old binary back across an incompatible schema; restore a verified pre-upgrade backup and the matching source revision instead. Record the deployed commit with each backup. Pin tested container image digests for controlled releases; refresh them regularly with the production CI test. The provided major-version image tags receive upstream fixes and are not immutable releases.

## Backups and restore

```bash
bash scripts/backup.sh
# Test restore on a separate installation before relying on a backup:
bash scripts/restore.sh backups/TIMESTAMP --replace-data
```

Backup briefly stops the app to pair the SQL snapshot with an upload archive, then restarts it even if the backup fails. Only backups containing SHA256SUMS and passing verification are complete. Restore overwrites existing database tables and restores files; it leaves the app stopped if anything fails. Restore into a clean uploads volume when recovering on a new host. Extra files in an existing volume are not removed. Back up the private configuration/secrets separately; restoring only database/media cannot reproduce those settings.

Schedule `bash scripts/backup.sh` from the repository directory with cron or your backup system, and copy completed backups to encrypted off-server storage. Define retention and regularly test recovery. Files contain private messages and account password hashes. No automatic backup upload or retention deletion is configured.

## Operations

```bash
docker compose ps
docker compose logs --tail=100 app
docker compose logs --tail=100 migrate
docker compose logs --tail=100 proxy
```

Monitor `/api/health` externally, disk usage, backup age, container restarts and failed sign-ins. Logs rotate at 10 MB with three files per service. Docker restarts crashed processes; an unhealthy status alone does not restart a running container. Database connection queues are bounded; shutdown has a 30-second deadline.

CI builds and starts the production image with MySQL, verifies frontend/security headers/secure sessions, validates proxy configuration, and exercises backup/restore. It also runs application integration and browser tests. CI cannot validate your domain's certificate issuance, server firewall, off-server backup destination or TURN relay.

## Current product limits

Browser notification banners and sounds require the app to stay open and connected; closed-browser push is not implemented. Password changes require the current password; forgotten-password recovery and email verification are not implemented. Public signup is enabled with rate limits. Define your moderation, account recovery and privacy/retention process before a public launch. Uploaded files remain on this server, so disk capacity and backups matter. This setup does not deploy the live service until you supply a server/domain and configure DNS and credentials.

Reference: [Docker startup ordering](https://docs.docker.com/compose/how-tos/startup-order/), [Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/), [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https), [Caddy WebSocket proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
