'use strict';

/**
 * Trust & safety integration point.
 *
 * Every content write and every user report flows through this module.
 *
 *   • evaluateContent('photo', …) -> POST /items/async/  (Coop runs its rules
 *     engine + HMA image-hash matching; enforcement arrives later as a webhook
 *     Action callback handled in server.js). Asynchronous, so it never blocks
 *     the upload — the photo is stored, then removed/flagged if Coop decides so.
 *
 *   • submitReport(…) -> POST /report  (routed to Coop's review queue for a
 *     human moderator). Returns queued:true once Coop accepts it.
 *
 * When Coop is not configured (COOP_ENABLED off or no API key), every function
 * is a no-op so the app runs standalone. See COOP_INTEGRATION.md for setup.
 */

const { coop } = require('./config');
const client = require('./coop-client');

function log(hook, detail) {
  console.log(`[T&S] ${hook}`, detail);
}

/**
 * Real-time hook on content before/at write time.
 * Coop enforcement is asynchronous (decision via webhook), so this ALWAYS
 * returns allow:true. For photos it fires an item submission in the background.
 *
 * @param {'photo'|'comment'|'caption'} kind
 * @param {object} content  for photos: { photo: <row>, author: <user> }
 * @returns {{ allow: boolean }}
 */
function evaluateContent(kind, content) {
  if (!coop.active) {
    log(`evaluateContent(${kind})`, 'no-op (Coop disabled)');
    return { allow: true };
  }
  if (kind === 'photo' && content && content.photo && content.author) {
    client
      .submitPhoto(content.photo, content.author)
      .then((r) =>
        log(`submitPhoto(#${content.photo.id}) -> Coop ${r.status}`, 'enforcement will arrive via webhook')
      )
      .catch((e) =>
        // Fail open: a Coop outage does not block posting. Switch to fail-closed
        // (hold the photo pending review) if your policy requires it.
        console.error(`[T&S] Coop submitPhoto failed (fail-open, photo kept):`, e.message, e.body || '')
      );
  } else {
    log(`evaluateContent(${kind})`, 'no automated submission configured for this kind');
  }
  return { allow: true };
}

/**
 * A user reported a photo or comment -> Coop Review Console.
 * @returns {Promise<{received:boolean, queued:boolean, reportId?:string, error?:string}>}
 */
async function submitReport(report) {
  if (!coop.active) {
    log('submitReport', 'no-op (Coop disabled) — report not queued');
    return { received: true, queued: false };
  }
  // Ingest the people involved as Coop User items first, so Coop can show the
  // reporter and the reported content's author by username (not just id).
  for (const u of report.relatedUsers || []) {
    client.submitUser(u).catch((e) => console.error('[T&S] Coop submitUser failed:', e.message, e.body || ''));
  }
  try {
    const r = await client.submitReport(report);
    log('submitReport -> Coop', { status: r.status, reportId: r.body.reportId, timesReported: report.timesReported });
    return { received: true, queued: true, reportId: r.body.reportId };
  } catch (e) {
    console.error('[T&S] Coop submitReport failed:', e.message, e.body || '');
    return { received: true, queued: false, error: 'coop_unreachable' };
  }
}

function notifyContentChanged(change) {
  log('notifyContentChanged', change);
}

module.exports = { evaluateContent, submitReport, notifyContentChanged };
