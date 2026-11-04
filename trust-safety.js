'use strict';

/**
 * ============================================================================
 *  THE TRUST & SAFETY SEAM  —  deliberately empty.
 * ============================================================================
 *
 * Bird Buddies ships with NO trust & safety tooling. This module is the single
 * place where every piece of user-generated content and every user report
 * flows through, and right now every function here is a no-op: content is
 * always allowed, reports go nowhere, and no human ever reviews anything.
 *
 * This is the "before" state for a ROOST integration demo. To add safety, you
 * wire these four functions up to ROOST's open-source tools:
 *
 *   • COOP  (https://github.com/roostorg/coop) — review & moderation platform.
 *     Send content to Coop's REST/GraphQL ingest API so its rules engine can
 *     evaluate it and its Review Console can queue it for a human. Coop returns
 *     an enforcement decision (allow / flag / remove) that this app honors.
 *       - evaluateContent()  -> POST content to Coop, act on the decision
 *       - submitReport()     -> create a report job in Coop's review queue
 *
 *   • OSPREY (https://github.com/roostorg/osprey) — real-time rules engine.
 *     Call Osprey synchronously on each action (upload, comment, friend request)
 *     to get an instant allow/block verdict from SML rules before the write.
 *       - evaluateContent()  -> real-time Osprey verdict, block inline
 *
 * Each call below logs what it WOULD have sent, so you can watch the seam in
 * the server console today and see it come alive once ROOST tools are wired in.
 * ============================================================================
 */

function stub(hook, payload) {
  // In the baseline app this only logs. Replace with a real call to Coop/Osprey.
  console.log(`[T&S:NO-OP] ${hook} — nothing is reviewing this:`, payload);
}

/**
 * Real-time check on a piece of content before it is stored.
 * WHERE OSPREY PLUGS IN (synchronous allow/block) and where Coop's rules engine
 * can also be called for an inline decision.
 *
 * @param {'photo'|'comment'|'caption'} kind
 * @param {object} content  e.g. { userId, text, filename }
 * @returns {{ allow: boolean, reason?: string }}
 */
function evaluateContent(kind, content) {
  stub(`evaluateContent(${kind})`, content);
  // No rules, no models, no checks. Everything is allowed.
  return { allow: true };
}

/**
 * A user reported a photo or comment.
 * WHERE COOP PLUGS IN: this should open a job in Coop's Review Console so a
 * human (or an automated rule) can act on it. Today it evaporates.
 *
 * @param {object} report  e.g. { reporterId, targetType, targetId, reason }
 */
function submitReport(report) {
  stub('submitReport', report);
  // There is no review queue. The report is acknowledged to the user and dropped.
  return { received: true, queued: false };
}

/**
 * Hook for when content is deleted/edited, so moderation state can stay in sync.
 * WHERE COOP PLUGS IN: notify Coop that a previously-ingested item changed.
 */
function notifyContentChanged(change) {
  stub('notifyContentChanged', change);
}

module.exports = { evaluateContent, submitReport, notifyContentChanged };
