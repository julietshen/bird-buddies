#!/usr/bin/env node
'use strict';

// Create one Coop manual-review queue per Bird Buddies report reason, with the
// right role access. Run after setup-coop.mjs (which creates the policies).
//
//   COOP_ADMIN_EMAIL=... COOP_ADMIN_PASSWORD=... node scripts/setup-coop-queues.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const GRAPHQL_URL = process.env.COOP_GRAPHQL_URL || 'http://localhost:8080/api/v1/graphql';
const EMAIL = process.env.COOP_ADMIN_EMAIL;
const PASSWORD = process.env.COOP_ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error('Set COOP_ADMIN_EMAIL and COOP_ADMIN_PASSWORD'); process.exit(1); }

let cookie = '';
async function gql(query, variables = {}) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const sid = (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('connect.sid='));
  if (sid) cookie = sid;
  const json = await res.json().catch(() => ({}));
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data || {};
}
function pickId(o) {
  if (!o || typeof o !== 'object') return null;
  if (typeof o.id === 'string') return o.id;
  for (const v of Object.values(o)) { const f = pickId(v); if (f) return f; }
  return null;
}

// Which role can review each reason's queue.
const CHILD_SAFETY = new Set(['csam']);

async function main() {
  await gql(
    `mutation($e:String!,$p:String!){login(input:{email:$e,password:$p,remember:true}){__typename}}`,
    { e: EMAIL, p: PASSWORD }
  );
  console.log(`✓ logged in as ${EMAIL}`);

  const roles = (await gql(`{ rolesForOrg { id key } }`)).rolesForOrg || [];
  const roleId = Object.fromEntries(roles.map((r) => [r.key, r.id]));

  const doc = JSON.parse(readFileSync(join(ROOT, 'report-reasons.json'), 'utf8'));
  const reasons = (Array.isArray(doc) ? doc : doc.reasons || []).filter((r) => r.id && r.label);

  for (const r of reasons) {
    const roleIds = [CHILD_SAFETY.has(r.id) ? roleId.CHILD_SAFETY_MODERATOR : roleId.MODERATOR].filter(Boolean);
    try {
      const data = await gql(
        `mutation($input:CreateManualReviewQueueInput!){
           createManualReviewQueue(input:$input){ __typename
             ... on MutateManualReviewQueueSuccessResponse { data { id name } }
             ... on ManualReviewQueueNameExistsError { title }
           }
         }`,
        {
          input: {
            name: r.label,
            description: `Reports: ${r.label}`,
            userIds: [],
            roleIds,
            hiddenActionIds: [],
            isAppealsQueue: false,
            autoCloseJobs: false,
          },
        }
      );
      const node = data.createManualReviewQueue;
      if (node.__typename === 'ManualReviewQueueNameExistsError') {
        console.log(`• queue "${r.label}" already exists`);
        continue;
      }
      const id = pickId(node);
      r.queueId = id;
      console.log(`✓ queue "${r.label}" -> ${id} (role: ${CHILD_SAFETY.has(r.id) ? 'Child Safety Moderator' : 'Moderator'})`);
    } catch (e) {
      console.warn(`! queue "${r.label}": ${e.message}`);
    }
  }

  // Persist queue IDs back into report-reasons.json for the routing step.
  writeFileSync(join(ROOT, 'report-reasons.json'), JSON.stringify(doc, null, 2) + '\n');
  console.log('✓ wrote queue IDs into report-reasons.json');
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
