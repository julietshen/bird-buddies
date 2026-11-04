# Connecting Bird Buddies to Coop

[Coop](https://github.com/roostorg/coop) is ROOST's open-source review and
moderation platform. Bird Buddies sends photos to Coop for automated evaluation
and sends user reports to Coop's review queue for a human moderator. Coop calls
back with enforcement decisions, which Bird Buddies applies (remove or flag).

This guide covers a fully local setup (Bird Buddies and Coop on the same
machine), which is the simplest way to see reports land in the manual review
queue.

## 1. Run Coop locally

Follow Coop's own README/AGENTS.md. In short (from a Coop checkout):

```bash
pnpm run up            # Postgres, ClickHouse, Scylla, Redis, HMA, otel
pnpm install
cp server/.env.example server/.env
cp db/.env.example db/.env
cp client/.env.example client/.env
pnpm run db:create --env staging --db api-server-pg
pnpm run db:create --env staging --db scylla
pnpm run db:create --env staging --db clickhouse
pnpm run db:update  --env staging --db api-server-pg
pnpm run db:update  --env staging --db scylla
pnpm run db:update  --env staging --db clickhouse
pnpm run create-org --name "Bird Buddies" --email admin@example.com \
  --website https://example.com --firstName Admin --lastName User --password <pw>
pnpm run client:start   # console at http://localhost:3000
pnpm run server:start   # API at http://localhost:8080
```

Log in to the console at http://localhost:3000.

## 2. Create item types

In the Coop console, create the item types Bird Buddies submits (Settings →
Item Types). The type **IDs** you choose go in Bird Buddies' `.env`.

- **photo** — a `CONTENT` type with fields:
  - `images` — image field holding image URLs (this is what Coop runs HMA
    perceptual-hash matching on). The field name must match
    `COOP_PHOTO_IMAGES_FIELD` (default `images`).
  - `caption` — text
  - `authorId`, `authorUsername` — text
- **comment** — a `CONTENT` type with a `body` text field
- **user** — a `USER` type (used as the report's reporter)

## 3. Create an API key

Settings → API Keys → create a key. Copy it into `COOP_API_KEY`. This is sent as
the `X-API-KEY` header on every request Bird Buddies makes.

## 4. Create an Action and point it back at Bird Buddies

Enforcement is delivered as a webhook callback ("Action"). Create an Action whose
callback URL is Bird Buddies' webhook endpoint:

```
http://localhost:4000/webhooks/coop/action
```

Bird Buddies maps the callback to enforcement:
- policy penalty `HIGH`/`SEVERE`, or a human moderator action → photo `removed`
- penalty `LOW`/`MEDIUM` → photo `flagged`

### Optional: verify webhook signatures

Coop signs callbacks (RSA-SHA256, `coop-signature` header). To verify them, set
`COOP_VERIFY_WEBHOOK=true` and paste the org's "Webhook Signature Verification
Key" (PEM) into `COOP_WEBHOOK_PUBLIC_KEY`. Left off, callbacks are accepted
without verification (fine for local testing).

## 5. (Optional) Add a rule for automated enforcement

To see photos enforced automatically (not just via manual review), add a policy
and rule in Coop that fires on submitted photo items (for example, an HMA hash
match, or a simple rule on the caption) and attach the Action from step 4.

## 6. Configure Bird Buddies

```bash
cp .env.example .env
```

Set at least:

```
COOP_ENABLED=true
COOP_API_URL=http://localhost:8080/api/v1
COOP_API_KEY=<key from step 3>
COOP_PHOTO_TYPE_ID=<photo type id>
COOP_COMMENT_TYPE_ID=<comment type id>
COOP_USER_TYPE_ID=<user type id>
```

Restart Bird Buddies (`npm start`). The startup banner now shows the Coop URL.

## 7. Test the flows

**Report → manual review.** In Bird Buddies, open a photo and click **Report**.
Bird Buddies calls `POST /api/v1/report`. In the Coop console, open the review
queue — the report appears with the reporter, the photo (image shown via its
URL), and the reason. Make a decision there; if the attached Action fires, Coop
calls the webhook and the photo is removed or flagged in Bird Buddies.

**Upload → automated evaluation.** Post a photo. Bird Buddies calls
`POST /api/v1/items/async/`. Coop fetches the image URL, runs HMA hashing and any
enabled rules, and fires the Action if a rule matches. The photo is stored
immediately; enforcement (if any) applies when the webhook arrives.

## Notes

- Coop fetches image URLs itself, so uploads must be reachable from the Coop
  server. All-local dev works because both use `localhost`. If Coop runs
  elsewhere, set `PUBLIC_BASE_URL` to a host Coop can reach.
- Bird Buddies fails open: if Coop is unreachable, uploads and reports still
  succeed (reports return `queued:false`). Change this in `trust-safety.js` if
  you need fail-closed behavior.
