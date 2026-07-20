const { admin, enabled } = require('./firebase');

// Express middleware: verify the caller's Firebase ID token → req.uid.
// Returns 503 when notifications/Firebase aren't configured.
async function verifyFirebaseToken(req, res, next) {
  if (!enabled) return res.status(503).json({ error: 'notifications_disabled' });
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return res.status(401).json({ error: 'missing_token' });
  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    req.uid = decoded.uid;
    next();
  } catch (e) {
    res.status(401).json({ error: 'invalid_token' });
  }
}

module.exports = { verifyFirebaseToken };
