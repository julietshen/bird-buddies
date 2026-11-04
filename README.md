# 🐦 Bird Buddies

<img width="1498" height="740" alt="Screenshot 2026-11-04 at 1 43 08 PM" src="https://github.com/user-attachments/assets/f2918c73-8640-4d03-8541-a69fb1609d8e" />

A cozy, friends-only photo-sharing app. Post photos, caption them, comment on
your buddies' moments, and add people to your flock.

**It ships with zero trust & safety tooling on purpose** Bird Buddies is the
"before" app for a ROOST integration demo: a realistic small social product
that has all the usual surfaces where harm shows up (uploads, captions,
comments, a report button) and *nothing* watching any of them.

## Run it

```bash
cd bird-buddies
npm install
npm start            # http://localhost:4000
```

Open two browsers (or a private window) to create two accounts, send a buddy
request, accept it, and watch each other's photos appear in the feed.

Reset everything by deleting `bird-buddies.db` and the files in `uploads/`.

## Stack

- **Node 24 + Express** — REST API in `server.js`
- **SQLite** (`better-sqlite3`) — single-file DB, schema in `db.js`
- **Vanilla JS SPA** — `public/` (no build step)
- Cookie sessions, bcrypt passwords, `multer` for image uploads

### Integration targets

- **[Coop](https://github.com/roostorg/coop)**: ROOST's open source review &
  moderation platform (REST + GraphQL ingest, rules engine, Review
  Console, child-safety NCMEC reporting workflows). Wire
  `evaluateContent()` and `submitReport()` in `trust-safety.js` to Coop's
  ingest/report APIs and honor the returned decisions.
- **[Osprey](https://github.com/roostorg/osprey)**: ROOST's real-time rules
  engine. Call `evaluateContent()` synchronously for an instant
  allow/block verdict before each write.
