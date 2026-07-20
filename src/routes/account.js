const express = require('express');
const { db } = require('../firebase');
const { verifyFirebaseToken } = require('../authMiddleware');

const router = express.Router();

// Cloud backup of the user's collection (Premium). Full-replace model: the app
// pulls+merges on first sign-in, then pushes the whole collection on changes.

router.get('/collection', verifyFirebaseToken, async (req, res, next) => {
  try {
    const doc = await db.collection('users').doc(req.uid).get();
    const data = doc.exists ? doc.data() : {};
    res.json({
      items: Array.isArray(data.collection) ? data.collection : [],
      tombstones: data.collectionTombstones && typeof data.collectionTombstones === 'object'
        ? data.collectionTombstones
        : {},
      updatedAt: data.collectionUpdatedAt || 0,
    });
  } catch (e) {
    next(e);
  }
});

router.put('/collection', verifyFirebaseToken, async (req, res, next) => {
  try {
    const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    const tombstones =
      req.body && req.body.tombstones && typeof req.body.tombstones === 'object'
        ? req.body.tombstones
        : {};
    // Guard against a payload that could blow past Firestore's 1 MiB doc limit.
    if (items.length > 5000) return res.status(413).json({ error: 'too_large' });
    await db.collection('users').doc(req.uid).set(
      { collection: items, collectionTombstones: tombstones, collectionUpdatedAt: Date.now() },
      { merge: true }
    );
    res.json({ ok: true, count: items.length });
  } catch (e) {
    next(e);
  }
});

// Cloud backup of the trainer "gamification" progress (XP, wins, medals,
// shinies). Sideload only — the store build hides all of this. Progress is
// merged losslessly on the client, so this is a plain full-replace blob.

router.get('/trainer', verifyFirebaseToken, async (req, res, next) => {
  try {
    const doc = await db.collection('users').doc(req.uid).get();
    const data = doc.exists ? doc.data() : {};
    res.json({
      trainer: data.trainer && typeof data.trainer === 'object' ? data.trainer : {},
      updatedAt: data.trainerUpdatedAt || 0,
    });
  } catch (e) {
    next(e);
  }
});

router.put('/trainer', verifyFirebaseToken, async (req, res, next) => {
  try {
    const trainer =
      req.body && req.body.trainer && typeof req.body.trainer === 'object'
        ? req.body.trainer
        : {};
    await db.collection('users').doc(req.uid).set(
      { trainer, trainerUpdatedAt: Date.now() },
      { merge: true }
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Current Premium entitlement for the signed-in user (set by the Stripe
// webhook). The app reads this to unlock Premium across devices.
router.get('/premium', verifyFirebaseToken, async (req, res, next) => {
  try {
    const doc = await db.collection('users').doc(req.uid).get();
    const data = doc.exists ? doc.data() : {};
    res.json({ premium: !!data.premium, info: data.premiumInfo || null });
  } catch (e) {
    next(e);
  }
});

// Self-service account deletion: remove the user's whole document (collection,
// tombstones, trainer progress, wishlist watches, FCM token, notify state).
// The client also deletes the Firebase Auth account itself.
router.delete('/', verifyFirebaseToken, async (req, res, next) => {
  try {
    await db.collection('users').doc(req.uid).delete();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
