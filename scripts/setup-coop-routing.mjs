#!/usr/bin/env node
'use strict';

// Create Coop routing rules that send each reason's reports to its queue,
// matching on "Relevant Policy in item == <policy>". Run after
// setup-coop.mjs (policies) and setup-coop-queues.mjs (queues).
//
//   COOP_ADMIN_EMAIL=... COOP_ADMIN_PASSWORD=... \
//   COOP_PHOTO_TYPE_ID=... COOP_COMMENT_TYPE_ID=... node scripts/setup-coop-routing.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const GRAPHQL_URL = process.env.COOP_GRAPHQL_URL || 'http://localhost:8080/api/v1/graphql';
const EMAIL = process.env.COOP_ADMIN_EMAIL;
const PASSWORD = process.env.COOP_ADMIN_PASSWORD;
const ITEM_TYPE_IDS = [process.env.COOP_PHOTO_TYPE_ID, process.env.COOP_COMMENT_TYPE_ID].filter(Boolean);
if (!EMAIL || !PASSWORD) { console.error('Set COOP_ADMIN_EMAIL and COOP_ADMIN_PASSWORD'); process.exit(1); }
if (ITEM_TYPE_IDS.length === 0) { console.error('Set COOP_PHOTO_TYPE_ID (and COOP_COMMENT_TYPE_ID)'); process.exit(1); }

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

async function main() {
  await gql(`mutation($e:String!,$p:String!){login(input:{email:$e,password:$p,remember:true}){__typename}}`, { e: EMAIL, p: PASSWORD });
  console.log(`✓ logged in as ${EMAIL}`);

  const doc = JSON.parse(readFileSync(join(ROOT, 'report-reasons.json'), 'utf8'));
  const reasons = (Array.isArray(doc) ? doc : doc.reasons || []).filter((r) => r.policyId && r.queueId);

  for (const r of reasons) {
    const input = {
      name: `Route ${r.label}`,
      description: `Send ${r.label} reports to the ${r.label} queue`,
      status: 'LIVE',
      itemTypeIds: ITEM_TYPE_IDS,
      conditionSet: {
        conjunction: 'OR',
        conditions: [
          { input: { type: 'CONTENT_COOP_INPUT', name: 'Relevant Policy' }, comparator: 'EQUALS', threshold: r.policyId },
        ],
      },
      destinationQueueId: r.queueId,
    };
    try {
      const data = await gql(
        `mutation($input:CreateRoutingRuleInput!){
           createRoutingRule(input:$input){ __typename
             ... on MutateRoutingRuleSuccessResponse { data { id name } }
             ... on RoutingRuleNameExistsError { title }
             ... on QueueDoesNotExistError { title }
           }
         }`,
        { input }
      );
      const node = data.createRoutingRule;
      if (node.__typename === 'MutateRoutingRuleSuccessResponse') {
        console.log(`✓ routing "${r.label}" -> queue ${r.queueId}`);
      } else {
        console.log(`• routing "${r.label}": ${node.title || node.__typename}`);
      }
    } catch (e) {
      console.warn(`! routing "${r.label}": ${e.message}`);
    }
  }
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
