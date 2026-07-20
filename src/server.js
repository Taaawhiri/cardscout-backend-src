const express = require('express');
const cors = require('cors');
const config = require('./config');
const catalogRoutes = require('./routes/catalog');
const cartRoutes = require('./routes/cart');
const ordersRoutes = require('./routes/orders');
const notificationsRoutes = require('./routes/notifications');
const accountRoutes = require('./routes/account');
const { enabled: notificationsEnabled } = require('./firebase');
const { withUserToken } = require('./requestContext');
const priceWatcher = require('./priceWatcher');

const app = express();
app.use(cors());

// Stripe webhook must see the RAW request body for signature verification, so
// mount it with express.raw BEFORE the global JSON parser.
const stripeRoutes = require('./routes/stripe');
app.use('/api/stripe', express.raw({ type: 'application/json' }), stripeRoutes);

app.use(express.json());

// `rev` is a manual marker bumped on deploy so we can confirm from /api/health
// that the latest push actually went live on Render.
app.get('/api/health', (req, res) => {
  res.json({ ok: true, rev: 'fly-1', mockMode: config.mockMode, notifications: notificationsEnabled });
});

// Public pages: landing (a real website URL for payment-provider signup),
// terms, and the privacy policy — all linked from the app / store listings.
const privacyPage = require('./privacyPage');
const sitePages = require('./sitePages');
const sendHtml = (res, html) => res.set('Content-Type', 'text/html; charset=utf-8').send(html);
app.get('/', (req, res) => sendHtml(res, sitePages.landing));
app.get('/terms', (req, res) => sendHtml(res, sitePages.terms));
app.get('/privacy', (req, res) => sendHtml(res, privacyPage.html));

// Catalog/search: if the caller sent a personal CardTrader token, use it for
// this request's CardTrader calls instead of the shared token.
app.use('/api', withUserToken, catalogRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/account', accountRoutes);

app.use((err, req, res, next) => {
  const status = err.response?.status || 500;
  const data = err.response?.data;
  console.error(err.message);
  res.status(status).json(data || { error: 'internal_error', message: err.message });
});

app.listen(config.port, () => {
  console.log(`CardTrader proxy listening on :${config.port} (mockMode=${config.mockMode})`);
  // Kick off the wishlist price/availability watcher (no-op unless Firebase
  // is configured).
  priceWatcher.start();

  // Prewarm the search name cache in the background so the first user search
  // after a restart is fast, without waiting for the 6h cron. Delayed a few
  // seconds and never awaited, so it can't slow the boot or the request that
  // woke a spun-down instance. Failures are swallowed inside the function.
  if (!config.mockMode && typeof catalogRoutes.warmSupportedGames === 'function') {
    setTimeout(() => {
      catalogRoutes.warmSupportedGames().catch(() => {});
    }, 4000);
  }
});
