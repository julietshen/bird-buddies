# 🐦 Bird Buddies

<img width="1498" height="740" alt="Bird Buddies feed" src="https://github.com/user-attachments/assets/f2918c73-8640-4d03-8541-a69fb1609d8e" />

A cozy, friends-only photo-sharing web app. Post photos with captions, comment
on your friends' photos, and add people to your flock.

Bird Buddies is a reference application for integrating [ROOST](https://roost.tools)
trust & safety tooling. All user-generated content and all user reports pass
through a single module (`trust-safety.js`), which can run with no moderation at
all or route content to [Coop](https://github.com/roostorg/coop) for automated
enforcement and human review.

## Run it

```bash
npm install
npm start            # http://localhost:4000
```

Open two browsers (or a private window) to create two accounts, send a friend
request, accept it, and share photos.

Reset all data by deleting `bird-buddies.db` and the files in `uploads/`.

## Stack

- **Node 24 + Express** — REST API in `server.js`
- **SQLite** (`better-sqlite3`) — single-file DB, schema in `db.js`
- **Vanilla JS SPA** — `public/` (no build step)
- Cookie sessions, bcrypt passwords, `multer` for image uploads

## Trust & safety integration

Every content write and every report flows through `trust-safety.js`:

| App surface | Function | Behavior |
| --- | --- | --- |
| Photo upload | `evaluateContent('photo', …)` | Submits the photo to Coop for automated evaluation (rules engine + HMA image-hash matching) |
| User report | `submitReport(…)` | Sends the report to Coop's review queue for a human moderator |
| Enforcement | webhook `POST /webhooks/coop/action` | Coop calls back with a decision; the app removes or flags the photo |

When Coop is not configured, these are no-ops: content is stored unmodified and
reports are acknowledged but not queued. The app runs fully standalone in this
mode.

Coop enforcement is asynchronous: a photo is stored immediately, then taken down
(`removed`, hidden everywhere) or marked `flagged` (visible with a badge) when
Coop's webhook arrives.

See **[COOP_INTEGRATION.md](./COOP_INTEGRATION.md)** for setup (API key, item
types, actions, webhook, and `.env` configuration).

## Deploy

A `Dockerfile` is included. Set `SESSION_SECRET` (required) and point `DATA_DIR`
at a persistent volume so the SQLite DB and uploads survive redeploys. Set
`SECURE_COOKIES=true` and `PUBLIC_BASE_URL` to the public HTTPS URL.

**Fly.io** (uses `fly.toml`):

```bash
fly launch --no-deploy            # or: fly apps create <name>
fly volume create data --size 1
fly secrets set SESSION_SECRET=$(openssl rand -hex 32)
fly deploy
```

**Railway**: create a project from the repo (it builds the `Dockerfile`), add a
volume mounted at `/data`, and set variables `SESSION_SECRET`, `DATA_DIR=/data`,
`SECURE_COOKIES=true`, and `PUBLIC_BASE_URL`. Railway provides `PORT`
automatically.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
