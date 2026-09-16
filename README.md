# Message

A private, real-time messaging app for text, photos, and videos. Built with **React, Node.js, Express, Socket.IO, and MySQL**. Development lives on the `deployment` branch.

## Included

- Username/password registration and login; bcrypt password hashing; revocable HttpOnly cookie sessions.
- User search and one-to-one conversations, with a single conversation per pair.
- Persistent history, cursor pagination, unread counts, read receipts, online status, and typing indicators.
- JPG, PNG, WebP, GIF, MP4, and WebM attachments with captions, previews, upload progress, and video playback.
- Server-side file signature checks, upload limits, storage quotas, and participant-only media access.
- Responsive layout with device-aware light/dark mode and locally bundled fonts.
- Idempotent message sends: retrying the same send does not create duplicate records.
- MySQL schema migration, unit/integration tests, and GitHub Actions verification, including a two-account browser test.

See [SETUP.md](SETUP.md) for Windows development and HTTPS deployment instructions.

## Quick start

Requires Node.js **22.12+** (Node 24 recommended) and **MySQL 8.0+**.

```bash
git clone --branch deployment https://github.com/SANDYY2002/Message.git
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
| `npm run dev`              | API on 3000 and Vite on 5173                                                    |
| `npm run db:migrate`       | Apply the schema; safe to repeat                                                |
| `npm run build`            | Build frontend into frontend/dist                                               |
| `npm start`                | Start API; production mode also serves the built frontend                       |
| `npm test`                 | Run validation tests                                                            |
| `npm run test:integration` | Exercise real MySQL, HTTP, media, and sockets; requires DB_NAME ending in _test |

## Current scope

This version provides one-to-one messaging. Group chats, calls, password recovery, message editing/deletion, blocking, and push notifications are not implemented. There is no email requirement or seeded account; register your own users. Online status is visible to signed-in users, and the user directory is searchable by signed-in users.

Messages are protected by application authorization and HTTPS in production; this is **not end-to-end encryption**. A deployment administrator with database/storage access can access stored content. Uploaded media stays on the application server, with a default 25 MB per-file limit and 1 GB allowance per sender. MP4/WebM playback also depends on the browser supporting the video's codecs.

Deploy as **one Node process** with persistent local media storage. Multi-process scaling requires shared Socket.IO presence, a shared rate limiter, and shared/object storage. The inbox currently shows the 200 most recently active conversations; user search returns up to 30 results. Back up the MySQL database and uploads directory together. No server has been provisioned by committing this project.
