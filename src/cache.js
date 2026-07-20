// Tiny in-memory TTL cache to avoid hammering CardTrader's rate limits
// (200 req/10s overall, 10 req/s on /marketplace/products) when the same
// game/expansion/blueprint data is requested repeatedly.
//
// Bounded to a maximum number of entries: without a cap, crawling a big
// game (hundreds of expansions, each with a large marketplace blob) could
// grow this Map until the process hit V8's heap limit and aborted with
// exit 134 (SIGABRT / "JavaScript heap out of memory") — which is exactly
// what took the Render free-tier instance (512 MB) down. When full, the
// oldest entry is evicted (Map preserves insertion order).

const store = new Map();
// Blueprint lists are now trimmed to a small shape (see trimBlueprint), so a
// whole game's expansions (Pokémon alone is 850+) fit cheaply — cache them all
// so repeat searches don't re-crawl. Large per-expansion marketplace blobs are
// deliberately NOT cached during search, so entries stay small.
const MAX_ENTRIES = 1500;

function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  // Refresh recency: re-insert so it moves to the "newest" end.
  store.delete(key);
  store.set(key, entry);
  return entry.value;
}

function set(key, value, ttlMs) {
  if (store.has(key)) store.delete(key);
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
}

// In-flight loads, so N concurrent misses for the same key (e.g. an order
// resolving 40 card thumbnails that all map to the same few expansions)
// trigger ONE upstream fetch instead of a thundering herd against
// CardTrader's rate limit.
const inFlight = new Map();

async function getOrLoad(key, ttlMs, loader) {
  const cached = get(key);
  if (cached !== undefined) return cached;
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = (async () => {
    const value = await loader();
    set(key, value, ttlMs);
    return value;
  })();
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

// Whether a load for this key is already running. Lets the search route let
// same-query requests piggyback on an in-flight crawl (free) instead of
// counting them against the global crawl limit.
function isInFlight(key) {
  return inFlight.has(key);
}

module.exports = { get, set, getOrLoad, isInFlight };
