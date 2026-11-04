'use strict';

// Thin client for Coop's REST integration API (/api/v1).
// Docs: https://docs.roost.tools/coop/latest/  (api/items.md, api/report.md)
//
// Two outbound calls:
//   • submitPhoto()  -> POST /items/async/  (automated evaluation + enforcement)
//   • submitReport() -> POST /report        (manual human review queue)
//
// Enforcement decisions are NOT returned here — Coop delivers them later as a
// signed webhook Action callback (handled in server.js at /webhooks/coop/action).

const { coop, publicBaseUrl } = require('./config');

function imageUrl(filename) {
  return `${publicBaseUrl}/uploads/${filename}`;
}

async function call(pathname, body) {
  const res = await fetch(`${coop.apiUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': coop.apiKey },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Coop ${pathname} responded ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return { status: res.status, body: json };
}

// Submit a photo as a Coop item for automated evaluation.
// The photo id becomes the Coop item id so the enforcement webhook can map the
// decision back to our row. Images are sent as URLs (Coop fetches them itself).
async function submitPhoto(photo, author) {
  const item = {
    id: String(photo.id),
    typeId: coop.photoTypeId,
    data: {
      caption: photo.caption || '',
      [coop.imagesField]: [imageUrl(photo.filename)],
      authorId: String(author.id),
      authorUsername: author.username,
    },
  };
  return call('/items/async/', { items: [item] });
}

// Submit a user report into Coop's Review Console.
// `reportedItem` is a fully-formed Coop item ({ id, typeId, data }).
async function submitReport({ reporter, reportedAt, reason, reportedItem }) {
  const body = {
    reporter: { kind: 'user', typeId: coop.userTypeId, id: String(reporter.id) },
    reportedAt,
    reportedForReason: { reason: reason || '' },
    reportedItem,
  };
  return call('/report', body);
}

module.exports = { submitPhoto, submitReport, imageUrl };
