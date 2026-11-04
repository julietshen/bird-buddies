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

## Where the trust & safety is missing (the demo)

Every content write and every user report is routed through one module —
**`trust-safety.js`** — and today every function in it is a no-op. That single
file is the seam the demo lights up:

| Surface | Baseline behavior | What ROOST adds |
| --- | --- | --- |
| Photo upload (`POST /api/photos`) | stored as-is; no hashing, no scan | **Osprey** real-time verdict inline; **Coop** media ingest + HMA/PDQ hash matching |
| Caption & comments (`POST …/comments`) | stored as-is | **Osprey** SML rules for inline block; **Coop** rules engine + review |
| **Report button** (`POST /api/report`) | acknowledged, then dropped (`queued:false`) | **Coop** Review Console — opens a job a human/rule can act on |
| Enforcement | none — nothing is ever removed | **Coop** returns allow/flag/remove; app honors it via `notifyContentChanged` |

Watch the server console while you use the app: every write prints a
`[T&S:NO-OP]` line showing exactly what *would* be sent to Coop/Osprey.

### Integration targets

- **[Coop](https://github.com/roostorg/coop)** — ROOST's open-source review &
  moderation platform (REST + GraphQL ingest, rules engine, human Review
  Console, child-safety workflows). This is the primary demo target. Wire
  `evaluateContent()` and `submitReport()` in `trust-safety.js` to Coop's
  ingest/report APIs and honor the returned decisions.
- **[Osprey](https://github.com/roostorg/osprey)** — ROOST's real-time rules
  engine (SML rules). Call `evaluateContent()` synchronously for an instant
  allow/block verdict before each write.

> The demo narrative: *"Here's a normal little app with a report button that
> goes nowhere. Now let's point one file at Coop — and suddenly reports land in
> a review queue, media gets hash-checked, and rules can act in real time."*
