'use strict';

// Configuration for Bird Buddies, including the Coop integration.
// Reads a local .env file (no dependency) so you can point the app at a Coop
// instance without exporting shell vars. See .env.example.

const fs = require('fs');
const path = require('path');

(function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)?\s*$/);
    if (!m) continue; // skip blanks and comments
    let val = (m[2] || '').trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
})();

const bool = (v, d = false) => (v == null ? d : /^(1|true|yes|on)$/i.test(v));

const PORT = Number(process.env.PORT) || 4000;

// Base URL at which THIS app is reachable. Coop fetches image URLs itself
// (unauthenticated GET) at submission + review time, so uploads must be
// reachable from the Coop server. In all-local dev, localhost works for both.
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

const coop = {
  // Master switch. When off (default), the app behaves like the baseline:
  // nothing is sent anywhere and reports are dropped.
  enabled: bool(process.env.COOP_ENABLED, false),
  apiUrl: (process.env.COOP_API_URL || 'http://localhost:8080/api/v1').replace(/\/$/, ''),
  apiKey: process.env.COOP_API_KEY || '',

  // IDs of the item types / schemas you created in the Coop console.
  photoTypeId: process.env.COOP_PHOTO_TYPE_ID || 'photo',
  commentTypeId: process.env.COOP_COMMENT_TYPE_ID || 'comment',
  userTypeId: process.env.COOP_USER_TYPE_ID || 'user',

  // Name of the image-URL field in your photo item schema. Coop runs HMA
  // perceptual-hash matching on `data.images`, so the default is "images".
  imagesField: process.env.COOP_PHOTO_IMAGES_FIELD || 'images',

  // Webhook (Action callback) verification. Coop signs callbacks with RSA-SHA256
  // and sends the signature in the `coop-signature` header. Paste the org's
  // "Webhook Signature Verification Key" (PEM) to enable verification.
  verifyWebhook: bool(process.env.COOP_VERIFY_WEBHOOK, false),
  webhookPublicKey: (process.env.COOP_WEBHOOK_PUBLIC_KEY || '').replace(/\\n/g, '\n'),
};

// Coop is only "active" when enabled AND we have a key to authenticate with.
coop.active = coop.enabled && !!coop.apiKey;

module.exports = { PORT, publicBaseUrl, coop };
