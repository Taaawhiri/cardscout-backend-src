// Stripe webhook: turns subscription events into a Premium flag on the user's
// Firestore document, so the app unlocks Premium after payment. Mounted with
// express.raw() (see server.js) because signature verification needs the raw
// body. All secrets come from env vars — never hard-coded.
//
//   STRIPE_SECRET_KEY      the account's secret key (sk_live_… / sk_test_…)
//   STRIPE_WEBHOOK_SECRET  the signing secret of THIS endpoint (whsec_…)
const express = require('express');
const Stripe = require('stripe');
const { db, enabled: firebaseEnabled } = require('../firebase');
const { verifyFirebaseToken } = require('../authMiddleware');

const router = express.Router();

const SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = Stripe(SECRET_KEY || 'sk_placeholder');

// Statuses that count as "has access right now".
const ACTIVE = new Set(['active', 'trialing', 'past_due']);

async function setPremium(uid, active, info, customerId) {
  if (!uid || !firebaseEnabled || !db) return;
  const doc = {
    premium: !!active,
    premiumInfo: { active: !!active, source: 'stripe', updatedAt: Date.now(), ...info },
  };
  // Remember the Stripe customer so we can open the billing portal later.
  if (customerId) doc.stripeCustomerId = String(customerId);
  await db.collection('users').doc(uid).set(doc, { merge: true });
}

// The subscription events don't carry our uid, only the Stripe customer id, so
// we remember customer -> uid the first time (at checkout) and look it up after.
async function rememberCustomer(customerId, uid) {
  if (!customerId || !uid || !firebaseEnabled || !db) return;
  await db.collection('stripeCustomers').doc(String(customerId)).set({ uid }, { merge: true });
}
async function uidForCustomer(customerId) {
  if (!customerId || !firebaseEnabled || !db) return null;
  const snap = await db.collection('stripeCustomers').doc(String(customerId)).get();
  return snap.exists ? snap.data().uid : null;
}

async function handleEvent(event) {
  const obj = event.data.object || {};
  switch (event.type) {
    case 'checkout.session.completed': {
      const uid = obj.client_reference_id || (obj.metadata && obj.metadata.uid) || null;
      await rememberCustomer(obj.customer, uid);
      if (uid) await setPremium(uid, true, { subscription: obj.subscription || null }, obj.customer);
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const uid = await uidForCustomer(obj.customer);
      await setPremium(uid, ACTIVE.has(obj.status), {
        status: obj.status,
        until: (obj.current_period_end || 0) * 1000,
        subscription: obj.id,
      }, obj.customer);
      break;
    }
    case 'customer.subscription.deleted': {
      const uid = await uidForCustomer(obj.customer);
      await setPremium(uid, false, { status: 'canceled', subscription: obj.id }, obj.customer);
      break;
    }
    default:
      break; // ignore everything else
  }
}

// Checkout config for the app: the hosted Payment Link URLs for the monthly /
// yearly plans. The app appends ?client_reference_id=<uid>&prefilled_email=<email>
// so the webhook can map the completed checkout back to the Firebase user.
// This route is mounted under the express.raw() body parser (see server.js),
// but a GET has no body so that's harmless.
router.get('/config', (req, res) => {
  res.json({
    monthly: process.env.STRIPE_LINK_MONTHLY || null,
    yearly: process.env.STRIPE_LINK_YEARLY || null,
  });
});

// Stripe billing portal: a hosted page where a real subscriber can update
// their card, view invoices, or cancel. Returns { url } to open. 404
// no_subscription when the user has no Stripe customer (e.g. owner/lifetime
// Premium granted by override, or a user who never subscribed) — the app
// hides the button in that case, this is just a safety net.
router.post('/portal', verifyFirebaseToken, async (req, res, next) => {
  try {
    if (!SECRET_KEY) return res.status(503).json({ error: 'stripe_not_configured' });
    const snap = db ? await db.collection('users').doc(req.uid).get() : null;
    const customerId = snap && snap.exists ? snap.data().stripeCustomerId : null;
    if (!customerId) return res.status(404).json({ error: 'no_subscription' });
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `https://${req.get('host')}/`,
    });
    res.json({ url: session.url });
  } catch (e) {
    next(e);
  }
});

router.post('/webhook', async (req, res) => {
  if (!WEBHOOK_SECRET) return res.status(503).send('webhook not configured');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`signature verification failed: ${err.message}`);
  }
  // Acknowledge fast; do the work but never fail the webhook on a handler error
  // (Stripe would retry — fine, but don't 500 the delivery).
  try {
    await handleEvent(event);
  } catch (err) {
    console.error('stripe webhook handler error:', err && err.message);
  }
  res.json({ received: true });
});

module.exports = router;
