'use strict';

/**
 * Bird Buddies — a cozy friends-only photo-sharing app.
 *
 * Features: sign up, post photos with captions, comment, add friends, and a
 * (currently useless) Report button. Every content write and every report is
 * routed through ./trust-safety.js — the empty seam where ROOST's Coop and
 * Osprey will be wired in during the demo.
 */

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const db = require('./db');
const ts = require('./trust-safety');
const coopClient = require('./coop-client');
const config = require('./config');
const { coop, PORT } = config;
const reportReasons = require('./report-reasons');

const app = express();
const UPLOAD_DIR = config.uploadDir;
if (config.trustProxy) app.set('trust proxy', 1);

// --- uploads ---------------------------------------------------------------
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => {
    // Only a basic MIME gate. NOTE: there is NO image hashing (PDQ), NO CSAM
    // matching (HMA), NO content scanning here — that is exactly what a ROOST
    // integration would add at this boundary.
    cb(null, /^image\//.test(file.mimetype));
  },
});

// --- middleware ------------------------------------------------------------
// Stash the raw body so we can verify Coop's webhook signature (which is
// computed over the exact bytes of the request body).
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not signed in' });
  next();
}

// Are two users friends (accepted in both directions)?
const areFriends = db.prepare(`
  SELECT 1 FROM friendships a
  JOIN friendships b
    ON a.requester_id = b.addressee_id AND a.addressee_id = b.requester_id
  WHERE a.requester_id = ? AND a.addressee_id = ?
    AND a.status = 'accepted' AND b.status = 'accepted'
`);
function friends(aId, bId) {
  if (aId === bId) return true;
  return !!areFriends.get(aId, bId);
}

function publicUser(u) {
  return u && { id: u.id, username: u.username, display: u.display, bird: u.bird };
}

// ===========================================================================
//  AUTH
// ===========================================================================
app.post('/api/signup', (req, res) => {
  const { username, display, password, bird } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const clean = String(username).trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (clean.length < 2) return res.status(400).json({ error: 'username must be 2+ letters/numbers' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(clean))
    return res.status(409).json({ error: 'that username is taken' });

  const hash = bcrypt.hashSync(String(password), 10);
  const info = db
    .prepare('INSERT INTO users (username, display, bird, password) VALUES (?, ?, ?, ?)')
    .run(clean, (display || clean).trim().slice(0, 40), bird || '🐦', hash);
  req.session.userId = info.lastInsertRowid;
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim().toLowerCase());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password))
    return res.status(401).json({ error: 'wrong username or password' });
  req.session.userId = u.id;
  res.json({ user: publicUser(u) });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId)) });
});

// ===========================================================================
//  PHOTOS + FEED
// ===========================================================================
app.post('/api/photos', requireAuth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'a photo image is required' });
  const caption = String(req.body.caption || '').slice(0, 500);

  // Store first — Coop enforcement is asynchronous (arrives later via webhook),
  // so we persist the photo, then submit it for evaluation.
  const info = db
    .prepare('INSERT INTO photos (user_id, filename, caption) VALUES (?, ?, ?)')
    .run(req.session.userId, req.file.filename, caption);
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(info.lastInsertRowid);
  const author = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

  // >>> TRUST & SAFETY SEAM <<< submits the photo to Coop for automatic
  // enforcement (HMA image hashing + rules). Always allows inline.
  ts.evaluateContent('photo', { photo, author });

  res.json({ id: info.lastInsertRowid });
});

// Feed: your photos + your friends' photos, newest first.
app.get('/api/feed', requireAuth, (req, res) => {
  const me = req.session.userId;
  const rows = db
    .prepare(
      `
      SELECT p.id, p.filename, p.caption, p.status, p.created_at,
             u.username, u.display, u.bird, u.id AS user_id,
             (SELECT COUNT(*) FROM comments c WHERE c.photo_id = p.id) AS comment_count
      FROM photos p
      JOIN users u ON u.id = p.user_id
      WHERE p.status != 'removed'
        AND (
          p.user_id = @me
          OR p.user_id IN (
              SELECT a.addressee_id FROM friendships a
              JOIN friendships b ON a.requester_id = b.addressee_id AND a.addressee_id = b.requester_id
              WHERE a.requester_id = @me AND a.status = 'accepted' AND b.status = 'accepted'
            )
        )
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 100
    `
    )
    .all({ me });
  res.json({ photos: rows });
});

app.get('/api/photos/:id', requireAuth, (req, res) => {
  const photo = db
    .prepare(
      `SELECT p.*, u.username, u.display, u.bird FROM photos p JOIN users u ON u.id = p.user_id WHERE p.id = ?`
    )
    .get(req.params.id);
  if (!photo) return res.status(404).json({ error: 'not found' });
  if (photo.status === 'removed')
    return res.status(410).json({ error: 'this photo was removed by moderation' });
  if (!friends(req.session.userId, photo.user_id))
    return res.status(403).json({ error: 'you can only view friends\' photos' });

  const comments = db
    .prepare(
      `SELECT c.id, c.body, c.created_at, u.username, u.display, u.bird, u.id AS user_id
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.photo_id = ? ORDER BY c.created_at ASC, c.id ASC`
    )
    .all(req.params.id);
  res.json({ photo, comments });
});

// ===========================================================================
//  COMMENTS
// ===========================================================================
app.post('/api/photos/:id/comments', requireAuth, (req, res) => {
  const body = String((req.body || {}).body || '').trim().slice(0, 1000);
  if (!body) return res.status(400).json({ error: 'comment cannot be empty' });
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (!photo) return res.status(404).json({ error: 'not found' });
  if (!friends(req.session.userId, photo.user_id))
    return res.status(403).json({ error: 'you can only comment on friends\' photos' });

  // >>> TRUST & SAFETY SEAM <<< today this always returns allow.
  const verdict = ts.evaluateContent('comment', { userId: req.session.userId, text: body, photoId: photo.id });
  if (!verdict.allow) return res.status(403).json({ error: verdict.reason || 'blocked' });

  db.prepare('INSERT INTO comments (photo_id, user_id, body) VALUES (?, ?, ?)').run(
    photo.id,
    req.session.userId,
    body
  );
  res.json({ ok: true });
});

// ===========================================================================
//  REPORTING
// ===========================================================================
// The reasons shown in the report menu.
app.get('/api/report-reasons', requireAuth, (req, res) => {
  res.json({ reasons: reportReasons.map((r) => ({ id: r.id, label: r.label })) });
});

app.post('/api/report', requireAuth, async (req, res) => {
  const { targetType, targetId, reasonId, note } = req.body || {};
  const reporter = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const tId = Number(targetId) || 0;
  const tType = String(targetType || '');

  // Map the chosen reason -> a Coop policy + csam flag. Coop routes the report
  // to a review queue based on these: csam:true goes to the NCMEC queue; for the
  // rest, a reporting rule routes each policyId to its queue.
  const chosen = reportReasons.find((r) => r.id === reasonId);
  let reasonText = chosen ? chosen.label : 'Something else';
  if (note) reasonText += `: ${String(note).slice(0, 300)}`;
  const reportedForReason = { reason: reasonText.slice(0, 500), csam: !!(chosen && chosen.csam) };
  if (chosen && chosen.policyId) reportedForReason.policyId = chosen.policyId;

  // Resolve the reported item + its author, and build the Coop item carrying the
  // content AND metadata: caption/body, image, and the author's id + username.
  let reportedItem = null;
  let author = null;
  if (tType === 'photo') {
    const p = db.prepare('SELECT * FROM photos WHERE id = ?').get(tId);
    if (p) {
      author = db.prepare('SELECT * FROM users WHERE id = ?').get(p.user_id);
      reportedItem = {
        id: String(p.id),
        typeId: coop.photoTypeId,
        data: {
          caption: p.caption || '',
          [coop.imagesField]: [coopClient.imageUrl(p.filename)],
          ...(author && { authorId: { id: String(author.id), typeId: coop.userTypeId, name: author.username } }),
          ...(author && { authorUsername: author.username }),
        },
      };
    }
  } else if (tType === 'comment') {
    const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(tId);
    if (c) {
      author = db.prepare('SELECT * FROM users WHERE id = ?').get(c.user_id);
      reportedItem = {
        id: String(c.id),
        typeId: coop.commentTypeId,
        data: {
          body: c.body,
          ...(author && { authorId: { id: String(author.id), typeId: coop.userTypeId, name: author.username } }),
        },
      };
    }
  }
  if (!reportedItem) {
    reportedItem = { id: String(tId || 'unknown'), typeId: coop.photoTypeId, data: {} };
  }

  // Record the report in Bird Buddies, one row per (reporter, target), so the
  // count is accurate and the same user can't inflate it. Only NEW reports are
  // forwarded to Coop, keeping Coop's "reported N times" count accurate too.
  const ins = db
    .prepare('INSERT OR IGNORE INTO reports (reporter_id, target_type, target_id, reason_id, note) VALUES (?, ?, ?, ?, ?)')
    .run(reporter.id, tType, tId, chosen ? chosen.id : 'other', note ? String(note).slice(0, 300) : null);
  const timesReported = db
    .prepare('SELECT COUNT(*) AS c FROM reports WHERE target_type = ? AND target_id = ?')
    .get(tType, tId).c;

  if (ins.changes === 0) {
    // This reporter already reported this item — acknowledge without re-sending.
    return res.json({ received: true, queued: true, alreadyReported: true, timesReported });
  }

  // >>> TRUST & SAFETY SEAM <<< -> Coop Review Console (manual human review).
  const relatedUsers = [reporter, ...(author ? [author] : [])];
  const result = await ts.submitReport({
    reporter,
    reportedAt: new Date().toISOString(),
    reportedForReason,
    reportedItem,
    relatedUsers,
    timesReported,
  });
  res.json({ ...result, timesReported });
});

// ===========================================================================
//  COOP ENFORCEMENT WEBHOOK  — Coop calls us when an Action fires.
//  Configure an Action in Coop with callback URL <PUBLIC_BASE_URL>/webhooks/coop/action
// ===========================================================================
app.post('/webhooks/coop/action', (req, res) => {
  if (coop.verifyWebhook && coop.webhookPublicKey) {
    const ok = verifyCoopSignature(req.rawBody, req.header('coop-signature') || '', coop.webhookPublicKey);
    if (!ok) return res.status(401).json({ error: 'invalid coop-signature' });
  }
  const { item, policies = [], decisionReason, actorEmail, custom = {} } = req.body || {};
  if (!item || item.id == null) return res.status(400).json({ error: 'missing item' });

  const reason = decisionReason || (actorEmail ? `moderator: ${actorEmail}` : 'policy violation');

  // Each Coop action carries an `effect` in its callbackUrlBody (-> `custom`),
  // set by the setup script. Fall back to penalty when no effect is present.
  let effect = custom.effect;
  if (!effect) {
    const severe =
      !!actorEmail || policies.some((p) => ['HIGH', 'SEVERE'].includes(String(p.penalty || '').toUpperCase()));
    effect = severe ? 'remove' : 'flag';
  }

  const isPhoto = String(item.typeId) === String(coop.photoTypeId);
  const isComment = String(item.typeId) === String(coop.commentTypeId);

  switch (effect) {
    case 'warn':
    case 'flag':
      if (isPhoto) db.prepare("UPDATE photos SET status = 'flagged', mod_reason = ? WHERE id = ?").run(reason, item.id);
      break;
    case 'remove':
      if (isPhoto) db.prepare("UPDATE photos SET status = 'removed', mod_reason = ? WHERE id = ?").run(reason, item.id);
      else if (isComment) db.prepare('DELETE FROM comments WHERE id = ?').run(item.id);
      break;
    case 'remove_user':
      // "Delete account": take down all of the user's photos. item.id is the user.
      db.prepare("UPDATE photos SET status = 'removed', mod_reason = ? WHERE user_id = ?").run(reason, item.id);
      break;
    case 'escalate':
    case 'ncmec':
      // No content-state change here — escalate/NCMEC move the item to another
      // queue inside Coop. We just acknowledge and log.
      break;
    default:
      console.log(`[T&S] Coop action with unknown effect "${effect}" on ${item.typeId} #${item.id}`);
  }
  ts.notifyContentChanged({ itemType: item.typeId, itemId: item.id, effect, reason });
  console.log(`[T&S] Coop action on ${item.typeId} #${item.id} -> effect="${effect}" (${reason})`);
  res.status(200).json({ ok: true });
});

function verifyCoopSignature(rawBody, sigB64, publicKeyPem) {
  try {
    const v = crypto.createVerify('RSA-SHA256');
    v.update(rawBody || Buffer.alloc(0));
    v.end();
    return v.verify(publicKeyPem, Buffer.from(sigB64, 'base64'));
  } catch {
    return false;
  }
}

// ===========================================================================
//  FRIENDS
// ===========================================================================
app.get('/api/users', requireAuth, (req, res) => {
  const q = `%${String(req.query.q || '').toLowerCase()}%`;
  const rows = db
    .prepare(
      `SELECT id, username, display, bird FROM users
       WHERE id != ? AND (lower(username) LIKE ? OR lower(display) LIKE ?) LIMIT 20`
    )
    .all(req.session.userId, q, q);
  const me = req.session.userId;
  res.json({
    users: rows.map((u) => ({
      ...u,
      relation: relationLabel(me, u.id),
    })),
  });
});

const getEdge = db.prepare('SELECT * FROM friendships WHERE requester_id = ? AND addressee_id = ?');
function relationLabel(me, other) {
  if (friends(me, other)) return 'friend';
  if (getEdge.get(me, other)) return 'requested';
  if (getEdge.get(other, me)) return 'incoming';
  return 'none';
}

app.post('/api/friends/request', requireAuth, (req, res) => {
  const me = req.session.userId;
  const other = Number(req.body.userId);
  if (!other || other === me) return res.status(400).json({ error: 'bad user' });
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(other))
    return res.status(404).json({ error: 'no such user' });

  // If they already requested me, accept instead of creating a dup.
  if (getEdge.get(other, me)) {
    db.prepare("UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?").run(other, me);
    db.prepare("INSERT OR REPLACE INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'accepted')").run(me, other);
    return res.json({ relation: 'friend' });
  }
  db.prepare("INSERT OR IGNORE INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'pending')").run(me, other);
  res.json({ relation: 'requested' });
});

app.post('/api/friends/accept', requireAuth, (req, res) => {
  const me = req.session.userId;
  const other = Number(req.body.userId);
  if (!getEdge.get(other, me)) return res.status(400).json({ error: 'no pending request' });
  db.prepare("UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?").run(other, me);
  db.prepare("INSERT OR REPLACE INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'accepted')").run(me, other);
  res.json({ relation: 'friend' });
});

app.get('/api/friends', requireAuth, (req, res) => {
  const me = req.session.userId;
  const friendsList = db
    .prepare(
      `SELECT u.id, u.username, u.display, u.bird FROM friendships a
       JOIN friendships b ON a.requester_id = b.addressee_id AND a.addressee_id = b.requester_id
       JOIN users u ON u.id = a.addressee_id
       WHERE a.requester_id = ? AND a.status = 'accepted' AND b.status = 'accepted'`
    )
    .all(me);
  const incoming = db
    .prepare(
      `SELECT u.id, u.username, u.display, u.bird FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = ? AND f.status = 'pending'
         AND NOT EXISTS (SELECT 1 FROM friendships g WHERE g.requester_id = ? AND g.addressee_id = f.requester_id AND g.status = 'accepted')`
    )
    .all(me, me);
  res.json({ friends: friendsList, incoming });
});

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n  🐦  Bird Buddies is flying at http://localhost:${PORT}`);
  if (coop.active) {
    console.log(`      Trust & safety: COOP @ ${coop.apiUrl}`);
    console.log(`      Photos -> /items/async/ · reports -> /report · enforcement -> /webhooks/coop/action\n`);
  } else {
    console.log(`      Trust & safety: NONE (Coop disabled). Set COOP_ENABLED=true + COOP_API_KEY in .env.`);
  }
  if (!config.sessionSecretProvided) {
    console.log(`      ⚠ SESSION_SECRET not set — using a random secret; sessions reset on restart.`);
  }
  console.log('');
});
