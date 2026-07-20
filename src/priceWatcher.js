// Periodic wishlist price/availability checker. Reads every user's watches
// from Firestore, fetches the cheapest CardTrader listing per watched card,
// and pushes an FCM notification on a price drop below the user's target or a
// back-in-stock event. Per-user `notifyState` de-dupes so the same event
// isn't sent twice.

let cron = null;
try {
  cron = require('node-cron');
} catch (e) {
  console.warn('[priceWatcher] node-cron not installed — in-process schedule disabled');
}

const client = require('./cardtraderClient');
const config = require('./config');
const { db, messaging, enabled } = require('./firebase');

function euros(cents, currency) {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// Roll a single aggregate price-history doc (one read + one write per run) and
// return a map of blueprintId → drop vs the previous day's baseline.
async function updateHistoryAndFindDrops(prices) {
  const drops = new Map();
  if (!db) return drops;
  const day = todayStr();
  let history = {};
  try {
    const doc = await db.collection('meta').doc('priceHistory').get();
    if (doc.exists) history = doc.data().h || {};
  } catch (_) {
    return drops; // history unavailable this run; skip fallers
  }

  // Rebuild the history for only the currently-watched blueprints (bounds size).
  const next = {};
  for (const [id, p] of prices) {
    const h = history[id];
    if (!p.available) {
      if (h) next[id] = h; // keep the baseline while out of stock
      continue;
    }
    if (h && h.date !== day && h.cents > 0 && p.cents < h.cents) {
      drops.set(id, {
        pct: (h.cents - p.cents) / h.cents,
        fromCents: h.cents,
        toCents: p.cents,
        currency: p.currency,
      });
    }
    // Roll the baseline once per day (first run of a new day sets today's ref).
    next[id] = !h || h.date !== day ? { cents: p.cents, date: day } : h;
  }

  try {
    await db.collection('meta').doc('priceHistory').set({ h: next, updatedAt: Date.now() });
  } catch (_) {}
  return drops;
}

// Cheapest listing for a blueprint: { available, cents, currency } or null on
// an error we should skip (so a transient failure doesn't look like "out of
// stock").
async function cheapestFor(blueprintId) {
  try {
    const data = await client.get('/marketplace/products', { blueprint_id: blueprintId });
    const list = data && data[String(blueprintId)];
    if (!Array.isArray(list) || list.length === 0) return { available: false };
    const cheapest = list.reduce((min, p) => (p.price.cents < min.price.cents ? p : min));
    return { available: true, cents: cheapest.price.cents, currency: cheapest.price.currency };
  } catch (e) {
    return null;
  }
}

async function sendPush(tokens, notification, data) {
  if (!messaging || !tokens || tokens.length === 0) return;
  try {
    await messaging.sendEachForMulticast({
      tokens,
      notification,
      data: data || {},
    });
  } catch (e) {
    console.error('[priceWatcher] FCM send failed:', e.message);
  }
}

let running = false;

async function runOnce() {
  if (!enabled || config.mockMode || running) return;
  running = true;
  try {
    // Only load the fields the watcher needs — NOT the (potentially large)
    // cloud-synced `collection` field — so a full scan stays light on memory
    // and egress even with many users.
    const usersSnap = await db
      .collection('users')
      .select('tokens', 'watches', 'premium', 'notifyState')
      .get();
    if (usersSnap.empty) return;

    // One price lookup per unique blueprint across all users.
    const blueprintIds = new Set();
    usersSnap.forEach((doc) => (doc.data().watches || []).forEach((w) => blueprintIds.add(w.blueprintId)));
    const prices = new Map();
    for (const id of blueprintIds) {
      const p = await cheapestFor(id);
      if (p) prices.set(id, p);
    }

    // Daily "biggest faller" detection using a single aggregate history doc
    // (keeps Firestore reads/writes at O(1) regardless of user count). Compares
    // today's price against the baseline set on the first run of a previous day.
    const drops = await updateHistoryAndFindDrops(prices);

    for (const doc of usersSnap.docs) {
      const user = doc.data();
      const tokens = user.tokens || [];
      const watches = user.watches || [];
      if (tokens.length === 0 || watches.length === 0) continue;
      const state = user.notifyState || {};
      const premium = !!user.premium;
      let changed = false;

      for (const w of watches) {
        const p = prices.get(w.blueprintId);
        if (!p) continue;
        const key = String(w.blueprintId);
        const prev = state[key] || {};

        // Back in stock: was unavailable, now available (Premium only).
        if (premium && p.available && prev.lastAvailable === false) {
          await sendPush(
            tokens,
            {
              title: `${w.name}: di nuovo disponibile`,
              body: `Nuovi annunci da ${euros(p.cents, p.currency)}.`,
            },
            { type: 'back_in_stock', blueprintId: key }
          );
        }

        // Price drop to/below the user's target (only re-notify if the price
        // changed since the last alert).
        if (p.available && w.alertBelowCents > 0 && p.cents <= w.alertBelowCents) {
          if (prev.notifiedBelow !== p.cents) {
            await sendPush(
              tokens,
              {
                title: `${w.name}: prezzo sceso!`,
                body: `Ora da ${euros(p.cents, p.currency)}, sotto il tuo obiettivo di ${euros(w.alertBelowCents, w.currency)}.`,
              },
              { type: 'price_drop', blueprintId: key }
            );
            prev.notifiedBelow = p.cents;
            changed = true;
          }
        } else if (prev.notifiedBelow != null && p.available && p.cents > w.alertBelowCents) {
          // Rose back above target — clear so a future dip alerts again.
          delete prev.notifiedBelow;
          changed = true;
        }

        if (prev.lastAvailable !== p.available) {
          prev.lastAvailable = p.available;
          changed = true;
        }
        state[key] = prev;
      }

      // Biggest daily faller among the user's watched cards (Premium, once/day).
      if (premium && drops.size) {
        const day = todayStr();
        let best = null;
        for (const w of watches) {
          const d = drops.get(w.blueprintId);
          if (d && d.pct >= 0.15 && (!best || d.pct > best.pct)) best = { ...d, name: w.name };
        }
        if (best && state._fallerDate !== day) {
          await sendPush(
            tokens,
            {
              title: 'Grande calo del giorno 📉',
              body: `${best.name}: -${Math.round(best.pct * 100)}% → ${euros(best.toCents, best.currency)}.`,
            },
            { type: 'daily_faller' }
          );
          state._fallerDate = day;
          changed = true;
        }
      }

      if (changed) await doc.ref.set({ notifyState: state }, { merge: true });
    }
  } catch (e) {
    console.error('[priceWatcher] run failed:', e.message);
  } finally {
    running = false;
  }
}

function start() {
  if (!enabled) return;
  if (cron) {
    // Every 6h by default; override with CHECK_CRON (5-field cron expression).
    const fallback = '0 */6 * * *';
    const schedule = process.env.CHECK_CRON || fallback;
    const valid = cron.validate(schedule);
    if (!valid) {
      console.warn(`[priceWatcher] invalid CHECK_CRON "${schedule}", falling back to ${fallback}`);
    }
    cron.schedule(valid ? schedule : fallback, () => {
      runOnce().catch((e) => console.error('[priceWatcher] scheduled run failed:', e.message));
    });
    console.log(`[priceWatcher] scheduled: ${valid ? schedule : fallback}`);
  }
}

module.exports = { start, runOnce };
