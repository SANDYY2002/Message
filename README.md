# Message

A private, real-time messaging app for text, photos, and videos. Built with **React, Node.js, Express, Socket.IO, and MySQL**. The current release lives on `main`; `deployment` remains available for development.

## Included

- Username/password registration and login; bcrypt password hashing; revocable HttpOnly cookie sessions.
- User search and one-to-one conversations, with a single conversation per pair.
- Persistent history, cursor pagination, unread counts, read receipts, online status, and typing indicators.
- Edit your text/captions and delete your messages for both participants, with live updates and stale-edit protection.
- Search saved text and captions within a conversation, including older messages.
- JPG, PNG, WebP, GIF, MP4, and WebM attachments with captions, previews, upload progress, and video playback.
- Server-side file signature checks, upload limits, storage quotas, and participant-only media access.
- Responsive layout with device-aware light/dark mode and locally bundled fonts.
- Idempotent message sends: retrying the same send does not create duplicate records.
- MySQL schema migration, unit/integration tests, and GitHub Actions verification, including a two-account browser test.

See [SETUP.md](SETUP.md) for Windows development and HTTPS deployment instructions.

## Quick start

Requires Node.js **22.12+** (Node 24 recommended) and **MySQL 8.0+**.

```bash
git clone --branch main https://github.com/SANDYY2002/Message.git
cd Message
npm ci
cp backend/.env.example backend/.env
# Create the database and user; edit backend/.env (see SETUP.md).
npm run db:migrate
npm run dev
```

Open http://localhost:5173. Register two accounts in separate browser profiles to chat.

## Project map

```text
backend/src/         Express routes, authentication, sockets, database access
backend/test/        Validation tests and integration tests against real MySQL
frontend/src/        React interface, media composer, themes, API client
database/schema.sql Initial versioned MySQL schema
.github/workflows/  Build, security audit, and MySQL integration checks
```

## Commands

| Command                    | Purpose                                                                         |
| -------------------------- | ------------------------------------------------------------------------------- |
| `npm run dev`              | API on 4000 and Vite on 5173                                                    |
| `npm run db:migrate`       | Apply the schema; safe to repeat                                                |
| `npm run build`            | Build frontend into frontend/dist                                               |
| `npm start`                | Start API; production mode also serves the built frontend                       |
| `npm test`                 | Run validation tests                                                            |
| `npm run test:integration` | Exercise real MySQL, HTTP, media, and sockets; requires DB_NAME ending in _test |

## Current scope

This version provides one-to-one messaging. Group chats, calls, password recovery, blocking, and push notifications are not implemented. There is no email requirement or seeded account; register your own users. Online status is visible to signed-in users, and the user directory is searchable by signed-in users.

Messages are protected by application authorization and HTTPS in production; this is **not end-to-end encryption**. A deployment administrator with database/storage access can access stored content. Uploaded media stays on the application server, with a default 25 MB per-file limit and 1 GB allowance per sender. MP4/WebM playback also depends on the browser supporting the video's codecs.

Deploy as **one Node process** with persistent local media storage. Multi-process scaling requires shared Socket.IO presence, a shared rate limiter, and shared/object storage. The inbox currently shows the 200 most recently active conversations; user search returns up to 30 results. Back up the MySQL database and uploads directory together. No server has been provisioned by committing this project.

## Updating an existing installation

This release upgrades the schema to version 2. Back up the database and media directory, then run:

```bash
git pull origin main
npm ci
npm run db:migrate
npm run build
```

Restart your Node service afterward. The migration preserves accounts, conversations, and history, and safely resumes a partially applied upgrade. The server requires the latest migration before startup.

Editing is limited to a message's sender and changes text or the attachment caption. A deleted message becomes a visible placeholder; its text and attachment metadata are removed from the active database, and the media endpoint immediately stops serving the attachment. Disk cleanup is queued durably and retried each minute. Recipients may already have seen or downloaded content, and existing backups can still contain it. Retry identifiers are retained to prevent a network retry from restoring deleted messages.

Conversation search uses literal, case-insensitive matching over non-deleted text and captions, 30 results per page. Search does not mark matched messages as read. It does not search inside images or video content.

### Calling

One-to-one voice/video calls use WebRTC with authenticated Socket.IO signaling. Calls include accept/decline, microphone mute, camera toggle, hangup, and persisted call history. Run `npm run db:migrate` after updating. See [calling setup](SETUP.md#voice-and-video-calls) for HTTPS, permissions, and TURN configuration. The default API port is `4000`; existing private `.env` files must be updated manually.

### Profile settings

Open **Profile settings** in the conversation sidebar. Choose an avatar preset or upload a JPG, PNG or WebP (2 MB maximum, 16 megapixels maximum). The preview shows the center square crop; the server saves a 256×256 WebP image. Avatar access requires signing in. Changing to a preset removes the old uploaded image.

Usernames can be changed to an available name (3–24 lowercase letters, numbers or underscores); account ID, messages and group membership are preserved. Password changes require the current password and sign out all sessions. Sign in again with the new password.

After pulling this update, stop the app, run `npm ci` and `npm run db:migrate`, then restart with `npm run dev`. Migration 5 adds profile fields without resetting accounts or messages.

Groups can start with you and **one other registered user**. Enter a name, select a person, then click **Create group (2)**. The owner can add more members later, up to 50 total. If no people appear, another account must register first (or clear the search).

### Profiles and appearance

Open a person’s name or avatar to see their bio, posts, followers and following. Follow buttons show Follow, Follow Back or Unfollow according to your relationship. Edit your bio in Settings. Activity notifications are marked read when visible in the focused app; unseen notifications remain unread. Settings → Appearance includes the coloured Aurora theme alongside system, light and dark modes. Theme selection persists on this device. After updating, run `npm run db:migrate` to add profile bios.
