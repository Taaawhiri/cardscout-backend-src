// Firebase Admin bootstrap. Entirely optional and defensive: if the service
// account isn't configured (or the package/credentials are bad), the module
// exports `enabled: false` and the rest of the backend keeps working — the
// notification features simply stay off. It must never throw at import time.

let admin = null;
try {
  admin = require('firebase-admin');
} catch (e) {
  console.warn('[firebase] firebase-admin not installed — notifications disabled');
}

function loadCredential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw || !raw.trim()) return null;
  let text = raw.trim();
  // Accept either raw JSON or a base64-encoded blob (handy for one-line envs).
  if (!text.startsWith('{')) {
    try {
      text = Buffer.from(text, 'base64').toString('utf8');
    } catch (_) {
      /* fall through to JSON.parse, which will report the error */
    }
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('[firebase] FIREBASE_SERVICE_ACCOUNT is not valid JSON:', e.message);
    return null;
  }
}

let enabled = false;
let db = null;
let messaging = null;

if (admin) {
  try {
    const cred = loadCredential();
    if (cred) {
      admin.initializeApp({ credential: admin.credential.cert(cred) });
      db = admin.firestore();
      messaging = admin.messaging();
      enabled = true;
      console.log('[firebase] Admin initialised — notifications enabled');
    } else {
      console.warn('[firebase] FIREBASE_SERVICE_ACCOUNT not set — notifications disabled');
    }
  } catch (e) {
    console.error('[firebase] Admin init failed — notifications disabled:', e.message);
  }
}

module.exports = { admin, db, messaging, enabled };
