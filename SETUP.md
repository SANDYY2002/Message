# Setup and deployment

## 1. Get the main branch

Install Node.js 24 LTS, Git, and MySQL 8.0 or later. Then run:

```powershell
git clone --branch main https://github.com/SANDYY2002/Message.git
cd Message
npm ci
Copy-Item backend/.env.example backend/.env
```

On Linux/macOS, use `cp backend/.env.example backend/.env`.

## 2. Create a MySQL database

Open MySQL as an administrator. Choose your own database password and run:

```sql
CREATE DATABASE message CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'message'@'localhost' IDENTIFIED BY 'replace-with-your-password';
GRANT ALL PRIVILEGES ON message.* TO 'message'@'localhost';
```

For a remote database, create a user restricted to the application host and configure a private connection. Do not expose port 3306 publicly.

Update `backend/.env`:

```dotenv
NODE_ENV=development
PORT=4000
PUBLIC_ORIGIN=http://localhost:5173
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=message
DB_PASSWORD=replace-with-your-password
DB_NAME=message
UPLOAD_DIR=./uploads
MAX_UPLOAD_MB=25
MAX_USER_STORAGE_MB=1024
SESSION_DAYS=7
COOKIE_SECURE=false
TRUST_PROXY=0
```

Run the migration and start the app:

```powershell
npm run db:migrate
npm run dev
```

Open **http://localhost:5173**. Use this exact hostname; using 127.0.0.1 instead requires changing PUBLIC_ORIGIN. Vite proxies `/api` and `/socket.io` to the backend, so no frontend API environment variable is needed.

Register an account. Open a different browser profile/incognito window and register a second account. Click **+**, search for the other username, and open the conversation. Send text, attach a photo or video, and confirm it appears in the other window. Refresh either window to verify saved history.

For access from another device during development, set PUBLIC_ORIGIN to `http://YOUR_LAN_IP:5173` and visit that exact URL on both devices. Open only the development frontend port in your local firewall as needed.

## 3. Run checks

```powershell
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Integration tests need a separate MySQL database named `message_test`. They create test accounts/messages and intentionally expire sessions. Never use a production database.

```sql
CREATE DATABASE message_test CHARACTER SET utf8mb4;
CREATE USER 'message_test'@'localhost' IDENTIFIED BY 'choose-test-password';
GRANT ALL PRIVILEGES ON message_test.* TO 'message_test'@'localhost';
```

PowerShell:

```powershell
$env:DB_NAME="message_test"
$env:DB_USER="message_test"
$env:DB_PASSWORD="choose-test-password"
npm run test:integration
Remove-Item Env:DB_NAME, Env:DB_USER, Env:DB_PASSWORD
```

Linux/macOS:

```bash
DB_NAME=message_test DB_USER=message_test DB_PASSWORD=choose-test-password npm run test:integration
```

Tests apply the schema automatically, verify upgrading existing history from version 1 (including a partially applied version 2), and cover real HTTP registration/login, Socket.IO delivery, conversation authorization, cookie flags, CSRF/origin rejection, read receipts, pagination, file validation, rejected-upload cleanup, private media, retry deduplication, logout, expiry, edit ownership/conflicts, deletion, literal search, and failed media-cleanup retries. GitHub Actions runs these checks with MySQL 8.4 on each push to `main` or `deployment`.

### Browser verification

After the integration schema has been initialized, keep the test database environment variables set and run:

```bash
npx playwright install chromium
npm run test:e2e
```

The browser test starts the API and frontend, registers two accounts, exchanges text/images/video, checks read receipts, verifies history after refresh, and checks mobile dark mode, edits a message, searches saved text, and deletes an attachment while the other participant is searching. Screenshots and failure traces go to `test-results/`; the workflow uploads them as the `browser-verification` artifact. These are synthetic test accounts, not live user conversations.

## 4. Ubuntu production deployment

Use a server with Node.js 24, MySQL 8+, Nginx, a domain, and an HTTPS certificate. Run Node as a dedicated non-root user. Install the repository in `/srv/message`, owned by that user. Create `/srv/message-data/uploads` writable by the same user, outside the checkout, so new releases preserve media.

```bash
cd /srv/message
npm ci
cp backend/.env.example backend/.env
```

Set the database credentials and these production values:

```dotenv
NODE_ENV=production
PORT=4000
PUBLIC_ORIGIN=https://chat.example.com
COOKIE_SECURE=true
TRUST_PROXY=1
UPLOAD_DIR=/srv/message-data/uploads
```

Replace the sample domain with your own. Keep `.env` readable only by the service account. Production startup refuses an insecure origin or insecure session cookie.

```bash
npm run db:migrate
npm run build
npm start
```

In production Express serves `frontend/dist`, API routes, authenticated media, and Socket.IO from the same origin. Run it under systemd so it restarts when the server reboots.

Example `/etc/systemd/system/message.service` (adjust the node path and user to your installation):

```ini
[Unit]
Description=Message chat application
After=network.target mysql.service

[Service]
Type=simple
User=message
Group=message
WorkingDirectory=/srv/message/backend
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /srv/message/backend/src/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
UMask=0077

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now message
sudo journalctl -u message -f
```

Example Nginx server block, **after obtaining a certificate**:

```nginx
server {
    listen 80;
    server_name chat.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name chat.example.com;
    ssl_certificate /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

    client_max_body_size 26m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 180s;
        proxy_send_timeout 180s;
    }
}
```

Do not add an Nginx alias for uploaded files: all media must pass through Express authorization. Only ports 80/443 should be publicly reachable; keep 4000 and 3306 private. The TRUST_PROXY=1 configuration above assumes exactly one trusted Nginx proxy. Adjust both proxy trust and forwarded headers if your architecture differs.

Check and reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Visit the HTTPS site in two browser profiles. Confirm login, real-time delivery, image uploads, video playback, and refresh persistence. `/api/health` verifies database connectivity.

## Vercel frontend deployment

The root `vercel.json` specifies the Vite preset, `npm ci`, `npm run build`, and output directory `frontend/dist`.

1. Import this repository and select `main` as the production branch.
2. Set **Root Directory** to the repository root (leave it empty), not `frontend`. The configuration paths are relative to this root.
3. Use Node.js 24 and the build settings supplied by `vercel.json`.
4. Create a new deployment from the latest `main` commit. Redeploying an old deployment reuses its old commit; disabling the cache does not change that commit.
5. Confirm the build runs Vite and produces `frontend/dist/index.html`.

If the log shows initial commit `2d3c63f`, the selected deployment still uses the old README-only source. If it complains about a missing `public` directory, verify the deployment includes the root `vercel.json` and uses the repository root.

This configuration publishes only the frontend. It does not start `backend/src/server.js`, provision MySQL, run migrations, or provide persistent uploads. The frontend currently calls same-origin `/api` and `/socket.io` routes; Vite's development proxy does not run in production. Login and chat require those routes to reach a configured backend. Do not put database credentials in frontend environment variables.

For the complete application with the current architecture, follow the Ubuntu production instructions above. Hosting the frontend separately requires API/realtime routing to that backend; migrating the backend to Vercel also requires adapting its runtime, shared realtime state, and persistent media storage. A successful frontend build alone is not a working full-app deployment.

See [Vercel project configuration](https://vercel.com/docs/project-configuration) for the configuration file reference.

## Updates and backups

Before updating, back up MySQL and `/srv/message-data/uploads` together. Keep backups private. Then pull `main`, run `npm ci`, migrate, build, and restart the service. Sessions are stored in MySQL and remain valid through a restart. Version 2 adds message edit/deletion metadata and a durable media deletion queue; run the migration before restarting the upgraded server. Existing history is preserved.

A completed upload that is interrupted by a process crash before its database commit may leave an orphan file. Compare upload filenames against `messages.media_path` before removing old unreferenced files; never delete files for an active upload. Normal rejected uploads are cleaned up automatically. Media removed through the message Delete control is placed in the `media_deletions` queue inside the same database transaction; failed disk removal is retried every minute. Monitor queue growth and filesystem permissions if deleted files cannot be removed. Database migration 1 uses idempotent DDL because MySQL DDL does not roll back atomically.

## Troubleshooting

- **Existing checkout after the port update:** Git does not update your private `backend/.env`. Change its `PORT` to `4000`, keep `PUBLIC_ORIGIN=http://localhost:5173` for local development, and restart `npm run dev`.
- **EACCES / EADDRINUSE when starting the API:** the operating system refused the selected port or it is already in use. Choose an available port in `backend/.env` and update both proxy targets in `frontend/vite.config.js` to match. The default is now `4000`.

- **Database access denied:** check DB_USER/DB_PASSWORD and the MySQL account host grants.
- **Origin not allowed / reconnecting:** PUBLIC_ORIGIN must exactly match the page's scheme, host, and port, with no trailing slash. Restart the API after changes.
- **Login does not persist locally:** COOKIE_SECURE should be false for local HTTP; production must use HTTPS and true.
- **413 on upload:** check MAX_UPLOAD_MB and the proxy body limit. Proxy limit should be slightly larger for multipart overhead.
- **Unsupported file:** the server detects real file contents; changing a filename extension is insufficient. SVG and executable content are not accepted.
- **Video not playable:** use an MP4 with H.264/AAC or a WebM supported by your browser. This release does not transcode media.
- **Missing tables:** run `npm run db:migrate` before starting the API.
- **Forgotten password:** self-service reset is not included in this version. Do not promise account recovery until a verified recovery flow is added.

## Voice and video calls

Pull `main`, keep `PORT=4000` in your private `backend/.env`, and run `npm run db:migrate` before `npm run dev`. Migration 3 adds call history without changing existing messages. The browser stays at `http://localhost:5173`.

Sign in as two different users in separate browser profiles. Open their conversation and click Voice call or Video call, allow microphone/camera access, and accept in the second window. Use headphones to avoid feedback. The call controls mute the microphone, toggle the camera, and hang up. The history button shows recent calls and missed calls with older-page loading. Media is not recorded or stored; MySQL stores call participants, type, status and timestamps only. Accepted timestamps indicate acceptance, not proof of media connection.

Incoming calls require the recipient to have the app open and connected. Unanswered invitations expire after 30 seconds. Calls end on logout, socket disconnect, server restart, or after four hours. Camera/microphone permissions must be allowed; cancelling during a permission prompt discards and stops any media granted later. One call per user is enforced across tabs; answering on one tab dismisses the invitation on the others.

For two separate devices, serve the app over HTTPS and set PUBLIC_ORIGIN to that exact origin. Plain HTTP on a LAN IP does not provide browser microphone/camera access. Calls across different networks may need a TURN relay. Configure your own coturn server with shared-secret authentication, then set these backend environment values:

```dotenv
STUN_URL=stun:turn.example.com:3478
TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp
TURN_SECRET=replace-with-your-coturn-shared-secret
```

Replace the example host with your configured relay; these are not working relay credentials. The authenticated config endpoint mints four-hour TURN credentials. Keep TURN_SECRET backend-only; the shared secret is never returned to clients. No third-party relay is configured by default. Configure the relay's TLS certificate and network/firewall ports according to its deployment, then test using devices on different networks.

Run one backend Node process for this version. Active signaling and busy state are in memory; multiple instances need shared coordination before scaling. Server startup marks unfinished history rows disconnected. If MySQL fails during hangup, media still stops and a history update error is logged; startup reconciles unfinished rows. Backend hosting is still required when the frontend is on Vercel.

## Message notifications

Click **Enable notifications** above the conversation list and allow notifications in the browser prompt. This preference is saved per account in that browser. Click **Disable notifications** to turn browser alerts off. If permission was blocked, change this site's notification permission in browser settings first. Browser notifications require HTTPS or localhost and a compatible browser; mobile browser support and OS notification settings vary.

New messages in other conversations produce an in-app alert. When the window is hidden or unfocused, enabled browser notifications show a generic notice without sender names, message text, or attachment previews. Clicking opens the conversation. The browser tab title also shows the unread count. Messages you send and messages in the actively focused conversation do not trigger alerts. Opening a conversation dismisses its system notifications; logout closes this account's notifications. Supported browsers use Web Locks to deduplicate alerts across tabs.

Keep Message open and connected to receive these alerts. The notification worker only displays notifications and handles clicks; it does not cache private messages or subscribe to background push. Closing the browser, losing connectivity, or the OS suspending the tab stops new alerts until you reconnect. Existing unread counts still refresh on reconnect. OS Focus Assist / Do Not Disturb may suppress browser banners or sounds.

## Group chats

After pulling `main`, run `npm run db:migrate` before restarting. Migration 4 adds group metadata and memberships while keeping existing direct conversations and messages intact. Keep the API on port 4000.

Click **New group** above the conversation list, enter a name, choose at least one other registered user, and click **Create group**. Groups support up to 50 members and use the same text, image/video uploads, search, message editing/deletion and notification features as direct chats. Sender names identify each participant. Unread counts are tracked separately for each member; group messages show Sent rather than individual Read receipts.

Open **Group details** in the chat header to see members. The creator is the owner and can rename the group, add/remove people, or transfer ownership to an existing member. Other members can leave. Owners must transfer ownership before leaving. Added members can read all existing group history. Removing/leaving revokes future access to history, search, downloads and messaging; it cannot erase copies already downloaded. Removed users stop receiving group message events and the chat disappears from their list.

Voice and video calls currently work only in direct conversations; this update does not add group calls.

## Profile settings update

Stop the development server, pull main, run `npm ci` and `npm run db:migrate`, then restart using `npm run dev`. Open **Profile settings** in the sidebar for avatar selection, square image uploads, unique username changes and password changes. Changing your password signs out all devices.
