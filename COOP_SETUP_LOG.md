# What a platform needs to set up Coop — running log

A checklist/journal of everything required to take an app from "no trust & safety"
to a working Coop integration, based on wiring up Bird Buddies. Ordered roughly
by dependency. "✅" = done in this demo.

## 0. Run / reach a Coop instance
- Coop server (REST + GraphQL API) and the review console, plus backing services
  (Postgres, ClickHouse, Scylla, Redis, HMA, otel). Locally: Docker compose +
  `pnpm run server:start` (:8080) and `pnpm run client:start` (:3000). ✅
- An **org + admin user**, created with Coop's `create-org` CLI. It also mints
  the **Main API Key** (shown once) and seeds a default User item type + built-in
  actions. ✅ (org "Bird Buddies"; admin admin@birdbuddies.com)
- **Moderator accounts** with roles for the review workflow: ADMIN,
  MODERATOR, MODERATOR_MANAGER, CHILD_SAFETY_MODERATOR, etc. ✅ (Akshay / Tiantian /
  Uma / Henry)

## 1. Auth / secrets
- **`X-API-KEY`** header on every REST call from the platform → Coop. ✅
- Coop → platform webhooks are signed (**`coop-signature`**, RSA-SHA256);
  platform verifies with the org's public key (optional locally). ✅
- GraphQL (console API, used for config like item types/policies/rules) auth is a
  **session cookie** from the `login` mutation — the API key does NOT work there. ✅

## 2. Define your content model (item types)
- One **item type per kind of content** you moderate: CONTENT (posts, comments),
  USER. Each has fields + field roles. ✅ (Post, Comment, User)
  - Image fields must be type `IMAGE` (or an `ARRAY` of IMAGE) so HMA can hash
    them; `ARRAY` containers require `keyScalarType: null`.
  - The author link uses the `creatorId` field role pointing to a `RELATED_ITEM`
    field (DB constraint enforces this).
  - User type carries username + display name (add email/IP/etc. in production). ✅

## 3. Integrate the app ↔ Coop (the four touchpoints)
- **Submit content for evaluation:** `POST /api/v1/items/async/` with the item
  (image fields as URLs Coop can fetch). Triggers HMA hashing + rules. Async. ✅
- **Submit user reports:** `POST /api/v1/report` with `reporter`,
  `reportedForReason {reason, policyId, csam}`, and `reportedItem {id,typeId,data}`
  carrying the content + metadata. ✅
- **Receive enforcement:** a webhook endpoint (`/webhooks/coop/action`) for Action
  callbacks; act on the decision (remove / flag / delete account / …). ✅
- **Send rich metadata** so moderators can decide: reported content + caption, the
  **author (username/display)**, **who reported it**, and an **accurate report
  count** (dedupe per reporter+target; also ingest users as User items so ids
  resolve to usernames). ✅

## 4. Policy taxonomy
- A **policy per violation category** (Spam, Scams, Harassment, Hate, Nudity,
  Violence, Self-harm, Child safety). Reports carry a `policyId`; rules reference
  policies. ✅

## 5. Enforcement actions
- Define the **actions** moderators (and rules) can take, each with a webhook
  callback URL. Give each a stable `effect` in `callbackUrlBody` so the platform
  knows what to do (warn/remove/remove_user/escalate/ncmec). ✅
  (Warning, Delete Post, Delete Comment, Delete Account, Escalate, NCMEC Review)

## 6. Review workflow (manual)
- **Review queues** (one per category) + **routing rules** that send each
  report to its queue by `Relevant Policy`. CSAM (`csam:true`) routes to the
  **NCMEC** flow automatically. ✅
- Grant queue access by role (Moderator; Child Safety Moderator for NCMEC). ✅

## 7. Automated enforcement (proactive)
- **Banks:**
  - **Text/word bank** (`createTextBank`, STRING or REGEX) — fully API-scriptable. ✅
    ("Scam & spam phrases")
  - **Image/HMA bank** (`createHashBank`) — the bank is created via Coop, but
    **hashes are added through the HMA service directly** (`POST {HMA}/c/bank/<hma_name>/content?url=…`,
    HMA fetches + PDQ-hashes) or via an exchange (NCMEC/StopNCII); Coop's GraphQL
    has no "add hash" mutation. ✅ set up ("Known bad images"; 2 scam/known images
    banked with correct PDQ hashes; rule "Auto-remove known bad images"
    (IMAGE_SIMILARITY_MATCH → Delete Post) is LIVE; Bird Buddies image URLs are
    HMA-reachable and hash to the right PDQ).
    HMA engine matching WORKS: `/m/lookup` returns the bank at distance 0 for a
    posted copy of a banked image. (Gotcha solved: OMM's index-cache task only
    runs under `--debug`/gunicorn and takes ~60s after restart to load the built
    index into the matcher — wait for `/status` to flip from INDEX-NOT-LOADED to
    I-AM-ALIVE. `build_indices` builds; the cache task loads.)
    ⚠️ Remaining gap — the Coop `IMAGE_SIMILARITY_MATCH` **rule** doesn't fire on
    Bird Buddies posts because our image field is `ARRAY<IMAGE>`: at submission
    Coop hashes each element into `{url, hashes}`, but the signal reads
    `imageValue.hashes` from a **single** image object, so `.hashes` is undefined
    on the array. A scalar `IMAGE` field is the fix, but the value shape matters —
    a scalar `{url}` object is rejected (400) and a bare URL string validates but
    (in testing) wasn't hashed. Needs the exact scalar image value Coop expects;
    the word-bank rule is the reliable automated-enforcement demo meanwhile.
- **Content rules** (`createContentRule`, status LIVE): a condition matching a
  bank (via `matchingValues.textBankIds` / `imageBankIds` + a match signal like
  `TEXT_MATCHING_CONTAINS_TEXT` / `IMAGE_SIMILARITY_MATCH`) → fires an action. ✅
  ("Auto-flag scam/spam phrases" → Warning; verified: scam caption auto-flagged)

## 8. Optional: custom model integrations
- Open safety models (CoPE, PolicyLM, SEA-Guard) plug in as **signal-provider
  packages** (manifest + `createSignals` + a `run()` that calls the model's HTTP
  endpoint), listed in `integrations.config.json`, surfacing a signal that rules
  use. Config (endpoint/key) is entered per-org in the console. ⏳

## Appendix: concrete data shapes & contracts

### A. Mapping YOUR app's reports → Coop
Your app has its own report model (reporter, target, reason). You need a stable
mapping layer:
- **content id/type → Coop item** `{id, typeId}` (Bird Buddies: `photo.id` →
  `{id: photo.id, typeId: COOP_PHOTO_TYPE_ID}`). Keep ids stable so Coop can
  correlate reports and send decisions back.
- **your reason → Coop `policyId` (+ `csam` flag)** (Bird Buddies: a
  `report-reasons.json` lookup).
- **your reporter → Coop reporter** `{kind:'user', typeId:<USER_TYPE_ID>, id}`.

Report payload (`POST /api/v1/report`, header `X-API-KEY`):
```json
{
  "reporter": { "kind": "user", "typeId": "<USER_TYPE_ID>", "id": "<reporterId>" },
  "reportedAt": "2026-11-05T00:00:00.000Z",
  "reportedForReason": { "reason": "Harassment or bullying", "policyId": "<policyId>", "csam": false },
  "reportedItem": {
    "id": "<contentId>",
    "typeId": "<POST_TYPE_ID>",
    "data": {
      "caption": "the reported text",
      "images": ["http://<host-ip>:4000/uploads/x.jpg"],
      "authorId": { "id": "<authorUserId>", "typeId": "<USER_TYPE_ID>", "name": "<username>" },
      "authorUsername": "<username>"
    }
  }
}
```

### B. Content for automated evaluation
```json
POST /api/v1/items/async/      (header X-API-KEY)
{ "items": [ { "id":"<contentId>", "typeId":"<POST_TYPE_ID>", "data": {
  "caption":"…", "images":["http://<host-ip>:4000/uploads/x.jpg"],
  "authorId":{"id":"<uid>","typeId":"<USER_TYPE_ID>","name":"<username>"},
  "authorUsername":"<username>" } } ] }
```
Rules:
- `data` fields MUST match the item type's schema (unknown fields → 400).
- `RELATED_ITEM` fields (author) are objects `{id, typeId, name}`, not bare ids.
- Image fields are **URLs Coop/HMA can fetch** (see networking note below).

### C. Recommended data to send (so moderators & models can decide)
- The content itself: text (caption/body) + image URLs.
- Author identity: id **+ username + display name** (also ingest authors +
  reporters as **User items** so ids render as names in the console).
- On reports: who reported, the reason/policy, and an **accurate report count**
  (track reports in your DB, deduped per reporter+target; only forward new ones).

### D. Webhook contract for enforcement actions
Coop → your app whenever an action fires (manual decision or automated rule):
```json
POST <your webhook>   (header: coop-signature = base64 RSA-SHA256 of raw body)
{
  "item": { "id":"<contentId>", "typeId":"<POST_TYPE_ID>" },
  "action": { "id":"<actionId>" },
  "policies": [ { "penalty":"HIGH" } ],
  "decisionReason": "…", "actorEmail": "mod@org",
  "custom": { "effect": "remove" }   // whatever you set as the action's callbackUrlBody
}
```
- Give each Coop action a stable directive in **`callbackUrlBody`** (e.g.
  `{"effect":"remove"}`) so your webhook acts on `custom.effect` instead of
  parsing action names.
- Map effect → enforcement in your app: remove / flag / remove_user / escalate / ncmec.
- **Verify `coop-signature`** with the org's public key before acting.
- You need the reverse map **Coop item {id,typeId} → your content** to enforce.

### E. Networking requirement (learned while wiring HMA)
Coop and HMA run in **containers**, so the image URLs you send must be reachable
*from inside those containers* — `http://localhost:<yourapp>` resolves to the
container, not your app. Use the **host's LAN IP** (or a real public URL) for
`PUBLIC_BASE_URL`. Bird Buddies now sends `http://<host-ip>:4000/...` so HMA can
fetch + PDQ-hash uploaded images (and the console can still display them).

## Gotchas worth remembering
- GraphQL config mutations need the **login session cookie**, not the API key.
- `create-org`/`bin` scripts fail under ts-node here; run the **compiled**
  `transpiled/bin/*.js` instead.
- Item submissions: `RELATED_ITEM` fields (e.g. author) must be objects
  `{id, typeId, name}`, not bare ids.
- Images must be at URLs **Coop can fetch** (localhost works when co-located).
- Console/session logs out on a timer — just log back in.
- The default User item type only has a `name` field until you add username/display.
