const express = require('express');
const { db, admin } = require('../firebase');
const { verifyFirebaseToken } = require('../authMiddleware');
const { runOnce } = require('../priceWatcher');

const router = express.Router();

// Register (or refresh) this device's FCM token under the user.
router.post('/register', verifyFirebaseToken, async (req, res, next) => {
  try {
    const token = String((req.body && req.body.fcmToken) || '').trim();
    if (!token) return res.status(400).json({ error: 'missing_fcmToken' });
    await db.collection('users').doc(req.uid).set(
      {
        tokens: admin.firestore.FieldValue.arrayUnion(token),
        updatedAt: Date.now(),
      },
      { merge: true }
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Replace the user's watch list (+ premium flag, which gates some alert types).
router.put('/watches', verifyFirebaseToken, async (req, res, next) => {
  try {
    const raw = Array.isArray(req.body && req.body.watches) ? req.body.watches : [];
    const watches = raw
      .filter((w) => w && Number.isFinite(Number(w.blueprintId)))
      .map((w) => ({
        blueprintId: Number(w.blueprintId),
        name: String(w.name || '').slice(0, 120),
        gameId: w.gameId != null ? Number(w.gameId) : null,
        expansion: w.expansion ? String(w.expansion).slice(0, 120) : null,
        currency: String(w.currency || 'EUR').slice(0, 8),
        alertBelowCents: Math.max(0, Number(w.alertBelowCents) || 0),
      }))
      .slice(0, 500);
    const premium = !!(req.body && req.body.premium);
    await db
      .collection('users')
      .doc(req.uid)
      .set({ watches, premium, updatedAt: Date.now() }, { merge: true });
    res.json({ ok: true, count: watches.length });
  } catch (e) {
    next(e);
  }
});

// External-scheduler hook: lets a cron service trigger a price check even if the
// in-process scheduler is asleep. Guarded by a shared secret.
router.post('/cron', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.query.key !== secret) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json({ ok: true, started: true });
  runOnce().catch((e) => console.error('[notifications] cron run failed:', e.message));
});

module.exports = router;
