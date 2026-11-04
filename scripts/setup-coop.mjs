#!/usr/bin/env node
'use strict';

/**
 * Bootstrap a Coop org for Bird Buddies: item types (post, comment, user),
 * policies (one per report reason), and actions (warning, delete post, delete
 * comment, delete account, escalate, NCMEC review).
 *
 * Coop splits this into two planes:
 *   1. Org + admin + API key  -> created by Coop's `create-org` CLI (writes to
 *      Postgres directly). This script can run it for you if COOP_DIR is set,
 *      otherwise it prints the command.
 *   2. Item types / policies / actions -> created via GraphQL mutations at
 *      /api/v1/graphql, authenticated with the admin session cookie from the
 *      `login` mutation (the API key does NOT authenticate GraphQL).
 *
 * After it runs, it writes the created policy IDs into report-reasons.json and
 * prints the COOP_* values to put in your .env.
 *
 * Usage:
 *   COOP_ADMIN_EMAIL=admin@example.com COOP_ADMIN_PASSWORD=... \
 *   COOP_WEBHOOK_URL=http://localhost:4000/webhooks/coop/action \
 *   node scripts/setup-coop.mjs
 *
 * Env:
 *   COOP_GRAPHQL_URL   default http://localhost:8080/api/v1/graphql
 *   COOP_ADMIN_EMAIL   required
 *   COOP_ADMIN_PASSWORD required
 *   COOP_WEBHOOK_URL   default http://localhost:4000/webhooks/coop/action
 *   COOP_DIR           optional path to the coop repo (to run create-org)
 *   COOP_ROTATE_KEY    "true" to rotate+print an API key via GraphQL
 *   ORG_NAME, ORG_WEBSITE, ADMIN_FIRST, ADMIN_LAST  (used only for create-org)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const GRAPHQL_URL = process.env.COOP_GRAPHQL_URL || 'http://localhost:8080/api/v1/graphql';
const EMAIL = process.env.COOP_ADMIN_EMAIL;
const PASSWORD = process.env.COOP_ADMIN_PASSWORD;
const WEBHOOK_URL = process.env.COOP_WEBHOOK_URL || 'http://localhost:4000/webhooks/coop/action';
const COOP_DIR = process.env.COOP_DIR;
const API_KEY = process.env.COOP_API_KEY || '';
const REST_BASE = GRAPHQL_URL.replace(/\/graphql\/?$/, '');

if (!EMAIL || !PASSWORD) {
  console.error('Set COOP_ADMIN_EMAIL and COOP_ADMIN_PASSWORD (the admin you created with create-org).');
  process.exit(1);
}

let cookie = '';

async function gql(query, variables = {}) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  const sid = setCookie.map((c) => c.split(';')[0]).find((c) => c.startsWith('connect.sid='));
  if (sid) cookie = sid;
  const json = await res.json().catch(() => ({}));
  if (json.errors) throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  return json.data || {};
}

// List an existing resource via the REST API (for idempotent reuse by name).
async function restList(path) {
  if (!API_KEY) return [];
  try {
    const r = await fetch(`${REST_BASE}${path}`, { headers: { 'X-API-KEY': API_KEY } });
    const d = await r.json().catch(() => []);
    return Array.isArray(d) ? d : d.itemTypes || d.policies || d.data || [];
  } catch {
    return [];
  }
}
const byName = (arr) => Object.fromEntries(arr.map((x) => [x.name, x.id]));

// Find a created record's id anywhere in a union response.
function pickId(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.id === 'string') return obj.id;
  for (const v of Object.values(obj)) {
    const found = pickId(v);
    if (found) return found;
  }
  return null;
}

function describe(obj) {
  // Surface error titles (e.g. "already exists") for logging.
  const t = obj && (obj.title || (obj.data && obj.data.title));
  return t || JSON.stringify(obj);
}

// --- phase 1: ensure org/admin exists --------------------------------------
async function login() {
  const data = await gql(
    `mutation($email:String!,$password:String!){
       login(input:{email:$email,password:$password,remember:true}){
         __typename
         ... on LoginSuccessResponse { user { id email role } }
       }
     }`,
    { email: EMAIL, password: PASSWORD }
  );
  const ok = data.login && data.login.__typename === 'LoginSuccessResponse';
  if (!ok) throw new Error(`login failed: ${describe(data.login)}`);
  console.log(`✓ logged in as ${data.login.user.email}`);
}

function runCreateOrg() {
  const args = [
    'run', 'create-org',
    '--name', process.env.ORG_NAME || 'Bird Buddies',
    '--email', EMAIL,
    '--website', process.env.ORG_WEBSITE || 'https://example.com',
    '--firstName', process.env.ADMIN_FIRST || 'Admin',
    '--lastName', process.env.ADMIN_LAST || 'User',
    '--password', PASSWORD,
  ];
  console.log(`Running create-org in ${COOP_DIR} ...`);
  const r = spawnSync('pnpm', ['--dir', COOP_DIR, ...args], { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  const m = (r.stdout || '').match(/API Key[^\n]*?[:：]\s*([A-Za-z0-9._-]{16,})/i);
  if (m) console.log(`\n>>> Save this API key for COOP_API_KEY in .env:\n    ${m[1]}\n`);
  if (r.status !== 0) throw new Error('create-org failed');
}

async function ensureOrg() {
  try {
    await login();
  } catch (e) {
    if (!COOP_DIR) {
      console.error(`\nCould not log in (${e.message}).`);
      console.error('Create the org + admin first, then re-run this script:\n');
      console.error(
        `  pnpm run create-org --name "Bird Buddies" --email "${EMAIL}" \\\n` +
          `    --website "https://example.com" --firstName "Admin" --lastName "User" \\\n` +
          `    --password "${PASSWORD}"\n`
      );
      process.exit(1);
    }
    runCreateOrg();
    await login();
  }
}

// --- phase 2: item types ----------------------------------------------------
async function createContentType(name, description, fields, fieldRoles) {
  const data = await gql(
    `mutation($input:CreateContentItemTypeInput!){
       createContentItemType(input:$input){ __typename
         ... on MutateContentTypeSuccessResponse { data { id name version } }
         ... on ItemTypeNameAlreadyExistsError { title detail }
       }
     }`,
    { input: { name, description, fields, fieldRoles } }
  );
  const id = pickId(data.createContentItemType);
  if (!id) throw new Error(`createContentItemType(${name}): ${describe(data.createContentItemType)}`);
  console.log(`✓ content type "${name}" -> ${id}`);
  return id;
}

async function createUserType(name, description, fields, fieldRoles) {
  const data = await gql(
    `mutation($input:CreateUserItemTypeInput!){
       createUserItemType(input:$input){ __typename
         ... on MutateUserTypeSuccessResponse { data { id name version } }
         ... on ItemTypeNameAlreadyExistsError { title detail }
       }
     }`,
    { input: { name, description, fields, fieldRoles } }
  );
  const id = pickId(data.createUserItemType);
  if (!id) throw new Error(`createUserItemType(${name}): ${describe(data.createUserItemType)}`);
  console.log(`✓ user type "${name}" -> ${id}`);
  return id;
}

// --- phase 3: policies ------------------------------------------------------
// reason id -> { policyName, policyType }  (Coop PolicyType enum; note the
// upstream spelling "HARRASSMENT").
const REASON_POLICY = {
  spam: { name: 'Spam', type: 'SPAM' },
  scam: { name: 'Scams', type: 'FRAUD_AND_DECEPTION' },
  harassment: { name: 'Harassment', type: 'HARRASSMENT' },
  hate: { name: 'Hate speech', type: 'HATE' },
  nudity: { name: 'Nudity or sexual content', type: 'SEXUAL_CONTENT' },
  violence: { name: 'Violence', type: 'VIOLENCE' },
  selfharm: { name: 'Self-harm or suicide', type: 'SELF_HARM_AND_SUICIDE' },
  csam: { name: 'Child safety', type: 'SEXUAL_EXPLOITATION' },
  // 'other' has no policy.
};

async function createPolicies() {
  const entries = Object.entries(REASON_POLICY);
  const existing = byName(await restList('/policies/')); // reuse by name (re-runnable)
  const toCreate = entries.filter(([, p]) => !existing[p.name]);
  const created = {};
  if (toCreate.length) {
    const data = await gql(
      `mutation($policies:[AddPolicyInput!]!){
         addPolicies(policies:$policies){ policies { id name } failures }
       }`,
      { policies: toCreate.map(([, p]) => ({ name: p.name, policyType: p.type })) }
    );
    for (const p of (data.addPolicies && data.addPolicies.policies) || []) created[p.name] = p.id;
  }
  const reasonToPolicyId = {};
  for (const [reasonId, p] of entries) {
    const id = existing[p.name] || created[p.name];
    if (id) {
      reasonToPolicyId[reasonId] = id;
      console.log(`✓ policy "${p.name}" -> ${id}${existing[p.name] ? ' (existing)' : ''}`);
    } else {
      console.warn(`! policy "${p.name}" not created`);
    }
  }
  return reasonToPolicyId;
}

// --- phase 4: actions -------------------------------------------------------
async function createAction(name, description, itemTypeIds, effect, applyUserStrikes = false) {
  const data = await gql(
    `mutation($input:CreateActionInput!){
       createAction(input:$input){ __typename
         ... on MutateActionSuccessResponse { data { id name callbackUrl } }
         ... on ActionNameExistsError { title detail }
       }
     }`,
    {
      input: {
        name,
        description,
        itemTypeIds,
        callbackUrl: WEBHOOK_URL,
        callbackUrlBody: { effect }, // Bird Buddies reads custom.effect in the webhook
        applyUserStrikes,
      },
    }
  );
  const id = pickId(data.createAction);
  if (!id) {
    console.warn(`! action "${name}": ${describe(data.createAction)}`);
    return null;
  }
  console.log(`✓ action "${name}" (effect=${effect}) -> ${id}`);
  return id;
}

// --- phase 5: optional API key rotation ------------------------------------
async function rotateApiKey() {
  const data = await gql(
    `mutation{ rotateApiKey(input:{name:"Bird Buddies",description:"Bird Buddies integration"}){
       __typename ... on RotateApiKeySuccessResponse { apiKey record { id name } } } }`
  );
  const key = data.rotateApiKey && data.rotateApiKey.apiKey;
  if (key) console.log(`\n>>> Rotated API key (put in COOP_API_KEY):\n    ${key}\n`);
  else console.warn(`! rotateApiKey: ${describe(data.rotateApiKey)}`);
}

// --- write report-reasons.json policyIds ------------------------------------
function writeReasonPolicies(reasonToPolicyId) {
  const file = join(ROOT, 'report-reasons.json');
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return;
  }
  const reasons = Array.isArray(doc) ? doc : doc.reasons || [];
  for (const r of reasons) {
    if (reasonToPolicyId[r.id]) r.policyId = reasonToPolicyId[r.id];
  }
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  console.log(`✓ wrote policy IDs into report-reasons.json`);
}

async function main() {
  console.log(`Coop GraphQL: ${GRAPHQL_URL}`);
  console.log(`Webhook URL:  ${WEBHOOK_URL}\n`);

  await ensureOrg();

  // Reuse any item types that already exist (create-org seeds a default User
  // type), so this script is safe to re-run.
  const existingTypes = byName(await restList('/item_types/'));
  const reuse = (name, id) => (console.log(`• item type "${name}" already exists -> ${id}`), id);

  // Item types. Images are an array of IMAGE so Coop runs HMA hashing on them.
  const postType = existingTypes['Post'] ? reuse('Post', existingTypes['Post']) : await createContentType(
    'Post',
    'Bird Buddies photo posts',
    [
      { name: 'caption', type: 'STRING', required: false, container: null },
      { name: 'images', type: 'ARRAY', required: false, container: { containerType: 'ARRAY', keyScalarType: null, valueScalarType: 'IMAGE' } },
      { name: 'authorId', type: 'RELATED_ITEM', required: false, container: null },
      { name: 'authorUsername', type: 'STRING', required: false, container: null },
    ],
    { creatorId: 'authorId' }
  );
  const commentType = existingTypes['Comment'] ? reuse('Comment', existingTypes['Comment']) : await createContentType(
    'Comment',
    'Bird Buddies comments',
    [
      { name: 'body', type: 'STRING', required: true, container: null },
      { name: 'authorId', type: 'RELATED_ITEM', required: false, container: null },
    ],
    { creatorId: 'authorId' }
  );
  const userType = existingTypes['User'] ? reuse('User', existingTypes['User']) : await createUserType(
    'User',
    'Bird Buddies users',
    [
      { name: 'username', type: 'STRING', required: true, container: null },
      { name: 'displayName', type: 'STRING', required: false, container: null },
    ],
    { displayName: 'displayName' }
  );

  const reasonToPolicyId = await createPolicies();

  const all = [postType, commentType, userType];
  await createAction('Warning', 'Warn the user; flag the content', all, 'warn', true);
  await createAction('Delete Post', 'Remove a post', [postType], 'remove');
  await createAction('Delete Comment', 'Remove a comment', [commentType], 'remove');
  await createAction('Delete Account', "Remove a user's account and content", [userType], 'remove_user', true);
  await createAction('Escalate', 'Escalate for senior review', all, 'escalate');
  await createAction('NCMEC Review', 'Route to child-safety / NCMEC review', all, 'ncmec');

  writeReasonPolicies(reasonToPolicyId);

  if (/^(1|true|yes|on)$/i.test(process.env.COOP_ROTATE_KEY || '')) await rotateApiKey();

  console.log('\nDone. Add these to bird-buddies/.env:');
  console.log(`  COOP_ENABLED=true`);
  console.log(`  COOP_API_KEY=<the API key from create-org or --rotate-key>`);
  console.log(`  COOP_PHOTO_TYPE_ID=${postType}`);
  console.log(`  COOP_COMMENT_TYPE_ID=${commentType}`);
  console.log(`  COOP_USER_TYPE_ID=${userType}`);
  console.log('\nThen create review queues in Coop and reporting rules that route each');
  console.log('policy to its queue (CSAM reports route to the NCMEC queue automatically).');
}

main().catch((e) => {
  console.error('\n✗ setup failed:', e.message);
  process.exit(1);
});
