const express = require('express');
const config = require('../config');
const client = require('../cardtraderClient');
const cache = require('../cache');
const mock = require('../mockData');
const { db: firestore } = require('../firebase');

const router = express.Router();

// CardTrader's list endpoints (games/expansions/blueprints) actually wrap
// results as { "array": [...] } in practice, despite the docs showing a bare
// array. Accept either shape, and treat anything else (e.g. an error object
// returned with a 2xx status, such as a rate-limit response) as an error
// instead of forwarding it as if it were real data.
function unwrapArray(value, label) {
  const list = Array.isArray(value) ? value : value?.array;
  if (!Array.isArray(list)) {
    throw new Error(`Unexpected response from CardTrader for ${label}: ${JSON.stringify(value).slice(0, 500)}`);
  }
  return list;
}

// Runs fn over items with at most `limit` in flight at once, so a
// whole-game crawl (potentially hundreds of expansions) doesn't blow past
// CardTrader's 200 requests/10s overall rate limit.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const current = next++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Best-effort split of a free-text query like "Pikachu 128/100" into a name
// part (used for matching) and a trailing number (used only to rank
// results, since CardTrader's Blueprint object doesn't document exposing a
// collector-number field separately from the name).
function parseCardQuery(raw) {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.*?)\s*#?(\d+(?:\/\d+)?)\s*$/);
  return {
    namePart: (match ? match[1] : trimmed).trim().toLowerCase(),
    numberHint: match ? match[2] : null,
  };
}

// Pull the collector number out of a string like "15/62 ©1999" or "074/071"
// or "SV107" -> { num, den }. den is null when there's no "/total". Used to
// FILTER search results to the actual card the user typed a number for.
function parseCollectorNumber(value) {
  if (value === null || value === undefined) return null;
  const s = String(value);
  const withDen = s.match(/(\d+)\s*\/\s*(\d+)/);
  if (withDen) return { num: parseInt(withDen[1], 10), den: parseInt(withDen[2], 10) };
  const bare = s.match(/(\d+)/);
  return bare ? { num: parseInt(bare[1], 10), den: null } : null;
}

// A blueprint's own collector number, from its fixed_properties.
function blueprintCollectorNumber(bp) {
  const fp = bp && bp.fixed_properties;
  return parseCollectorNumber(fp && fp.collector_number);
}

// The collector number as a clean display string ("15/62 ©1999" -> "15/62",
// keeping the original digits/leading zeros), or the leading token ("SV107").
function displayCollectorNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw);
  const nm = s.match(/\d+\s*\/\s*\d+/);
  if (nm) return nm[0].replace(/\s+/g, '');
  const token = s.match(/[A-Za-z0-9]+/);
  return token ? token[0] : null;
}

// Does this blueprint match a typed collector number? Numerators must match
// (leading zeros ignored, both parsed as ints); if BOTH carry a set total the
// totals must match too, so "074/071" won't collide with "74/165".
function matchesNumber(bp, hint) {
  if (!hint) return true;
  const b = blueprintCollectorNumber(bp);
  if (!b) return false; // no number on the card -> can't be the numbered card
  if (b.num !== hint.num) return false;
  if (hint.den !== null && b.den !== null && hint.den !== b.den) return false;
  return true;
}

// CardTrader's /blueprints/export objects are heavy: a big editable_properties
// array and a full image object on every card. Multiplied across a whole game
// (Pokémon alone is 850+ expansions) this is what OOM-killed Render's 512 MB
// instance. Keep only what the app and search actually use, so the cache can
// hold every expansion cheaply (fast repeat searches) without blowing the heap.
function trimBlueprint(bp) {
  return {
    id: bp.id,
    name: bp.name,
    version: bp.version,
    game_id: bp.game_id,
    category_id: bp.category_id,
    expansion_id: bp.expansion_id,
    image_url: blueprintImage(bp),
    // Small bag: carries collector_number (for number filtering) and the
    // game-specific rarity key the app reads via findValueContaining('rarity').
    fixed_properties: bp.fixed_properties,
  };
}

// Trimmed, cached blueprint list for one expansion (shared by browse, search,
// highlights and image resolution).
async function getExpansionBlueprints(expansionId) {
  return cache.getOrLoad(`blueprints:${expansionId}`, BLUEPRINTS_TTL, async () => {
    const raw = await client.get('/blueprints/export', { expansion_id: expansionId });
    return unwrapArray(raw, 'GET /blueprints/export').map(trimBlueprint);
  });
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Normalize a card/query name for matching: lowercase, strip accents and
// punctuation, collapse whitespace. So "Pokémon-EX!" and "pokemon ex" match,
// and the typo tolerance below compares clean tokens.
function normalizeName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Levenshtein edit distance with an early cap: bails out as soon as a whole DP
// row exceeds `max`, so it's cheap for the short names we compare.
function withinEditDistance(a, b, max) {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return false;
  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = new Array(lb + 1);
    cur[0] = i;
    let rowMin = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      let v = prev[j - 1] + cost;
      if (prev[j] + 1 < v) v = prev[j] + 1;
      if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return false;
    prev = cur;
  }
  return prev[lb] <= max;
}

// How well a card name matches a NORMALIZED query (see normalizeName), so the
// most relevant hits (exact name, then "name ..." like "Greninja ex", then the
// word anywhere) rank first and are never the ones cut off by the result cap.
function nameRelevance(name, qNorm) {
  if (!qNorm) return 0;
  const n = normalizeName(name);
  if (n === qNorm) return 3;
  if (n.startsWith(qNorm)) return 2;
  if (new RegExp(`\\b${escapeRegex(qNorm)}\\b`).test(n)) return 1;
  if (n.includes(qNorm)) return 1; // substring only (e.g. inside a longer word)
  return 0;
}

// Typo-tolerant fallback used when a card name doesn't literally contain the
// query: true when a name token is within a small edit distance of it. Only
// for queries long enough that a 1-2 char slip is a real typo, not noise.
function nameFuzzyMatches(name, qNorm) {
  if (qNorm.length < 4) return false;
  const max = qNorm.length <= 6 ? 1 : 2;
  for (const tok of normalizeName(name).split(' ')) {
    if (!tok) continue;
    if (Math.abs(tok.length - qNorm.length) > max) continue;
    if (withinEditDistance(tok, qNorm, max)) return true;
  }
  return false;
}

const GAMES_TTL = 60 * 60 * 1000; // 1h, games barely change
const CATEGORIES_TTL = 24 * 60 * 60 * 1000; // 24h, ~30 near-static categories
const EXPANSIONS_TTL = 60 * 60 * 1000; // 1h
const BLUEPRINTS_TTL = 24 * 60 * 60 * 1000; // 24h, a set's card list is static
const PRODUCTS_TTL = 30 * 1000; // 30s, CardTrader itself only lightly caches this
const SEARCH_TTL = 10 * 60 * 1000; // 10min — the whole-game crawl is expensive; cache assembled results

// Global cap on how many DISTINCT whole-game crawls run at once across ALL
// requests. Each crawl streams large per-expansion price blobs, so without a
// process-wide limit a burst of different cold searches would run dozens of
// crawls in parallel and OOM the 512 MB instance (the per-crawl concurrency
// only bounds work WITHIN one crawl). Requests that arrive while all slots
// are busy — and whose result isn't already cached or being crawled — are
// told they're queued so the app can show a message and retry, instead of
// piling on more concurrent memory. Tunable per instance RAM via the
// MAX_CONCURRENT_SEARCHES env var (see config.js).
const MAX_CONCURRENT_SEARCHES = config.maxConcurrentSearches;
let activeSearches = 0;
// Whole-expansion marketplace TTL: one call per expansion when you open
// its card list, so a slightly longer TTL keeps "starting from" prices
// snappy without re-fetching on every scroll.
const EXPANSION_PRODUCTS_TTL = 5 * 60 * 1000; // 5min

// Marketplace products for one expansion, keyed by blueprint id — powers
// the "starting from X" prices. One call to marketplace/products for the
// whole expansion instead of one per card.
async function fetchExpansionProducts(expansionId) {
  if (config.mockMode) {
    const byBlueprint = {};
    for (const [blueprintId, products] of Object.entries(mock.marketplaceProducts)) {
      const bp = mock.blueprints.find((b) => b.id === Number(blueprintId));
      if (bp && bp.expansion_id === expansionId) byBlueprint[blueprintId] = products;
    }
    return byBlueprint;
  }

  const data = await cache.getOrLoad(
    `expansion-products:${expansionId}`,
    EXPANSION_PRODUCTS_TTL,
    () => client.get('/marketplace/products', { expansion_id: expansionId })
  );
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(
      `Unexpected response from CardTrader for GET /marketplace/products (expansion): ${JSON.stringify(data).slice(0, 500)}`
    );
  }
  return data;
}

const CHEAPEST_TTL = 15 * 60 * 1000; // 15min — the small per-expansion price map

// Cheapest listing price per blueprint for an expansion, as a SMALL
// {blueprintId: price} map. The big marketplace blob is fetched inside the
// loader, reduced, and freed immediately — only the tiny map is cached (a few
// KB), so caching it is safe (unlike caching the raw blobs, which OOM-killed
// Render). Shared by search, the home highlights and the "starting from"
// prices, so the heavy CardTrader call happens at most once per 15min per
// expansion across all of them.
async function cheapestPricesByBlueprint(expansionId) {
  return cache.getOrLoad(`cheapest:${expansionId}`, CHEAPEST_TTL, async () => {
    let products = config.mockMode
      ? await fetchExpansionProducts(expansionId)
      : await client.get('/marketplace/products', { expansion_id: expansionId });
    const out = {};
    if (products && typeof products === 'object' && !Array.isArray(products)) {
      for (const [blueprintId, list] of Object.entries(products)) {
        if (Array.isArray(list) && list.length > 0) {
          out[blueprintId] = list.reduce((min, p) => (p.price.cents < min.price.cents ? p : min)).price;
        }
      }
    }
    products = null; // free the large blob before returning the small map
    return out;
  });
}

// Best-effort card image from a blueprint object, coping with the several
// shapes CardTrader uses (string image_url, or an `image` object with
// show/preview/url/original variants).
function blueprintImage(bp) {
  if (!bp || typeof bp !== 'object') return null;
  if (typeof bp.image_url === 'string' && bp.image_url) return bp.image_url;
  const img = bp.image;
  if (typeof img === 'string' && img) return img;
  if (img && typeof img === 'object') {
    return img.show || img.preview || img.url || img.original || null;
  }
  return null;
}

// 6h — highlights are a curated "what's hot" view, fine to recompute a few
// times a day; caching the (small) result avoids re-scanning expansions.
const HIGHLIGHTS_TTL = 6 * 60 * 60 * 1000;

// Expansions that aren't main sets — decks, promos, tins, championship /
// tournament packs, etc. Excluded from the home highlights so it shows real
// booster sets people actually buy, not structure decks with no singles.
const MINOR_SET_WORDS = [
  'deck',
  'starter',
  'structure',
  'promo',
  'tin',
  'gift',
  'blister',
  'tournament pack',
  'duelist pack',
  'limited pack',
  'trainer kit',
  'battle pack',
  'advent',
  'poncho',
  'bundle',
  'mcdonald',
  'sleeve',
  'binder',
  'championship',
  'energ', // "… Energy"/"… Energies" sub-sets aren't main sets (matches both)
  'product', // "… Products" sub-sets
  'reverse', // reverse-holo sub-sets ("… - Ball & Rocket Reverse")
  'poke ball',
  'pokeball',
];

function isMinorSet(name) {
  const lower = (name || '').toLowerCase();
  return MINOR_SET_WORDS.some((w) => lower.includes(w));
}

// A card-name safety net: even if we can't identify the game's single-card
// category, never let sealed product (a box/booster/tin) become a cover or a
// "chase card". Broader than isMinorSet (which is about expansion names).
const SEALED_CARD_WORDS = [
  'booster',
  'box',
  'display',
  'case',
  'tin',
  'blister',
  'deck',
  'bundle',
  'pack',
  'elite trainer',
  'collection',
  'binder',
  'sleeve',
  'playmat',
  'build & battle',
  'premium',
  'starter',
  'energ', // a basic/special Energy shouldn't become a set's cover/chase card
];

function looksSealedCard(name) {
  const lower = (name || '').toLowerCase();
  return SEALED_CARD_WORDS.some((w) => lower.includes(w));
}

// Hand-curated "most requested" expansions per game (CardTrader exposes no
// popularity data). Matched as case-insensitive substrings against the real
// expansion names at request time, in priority order, so both English and
// Japanese printings ("151" → "Pokémon Card 151") and slight naming
// differences still resolve. Anything not covered falls back to newest sets.
const POPULAR_EXPANSIONS = {
  pokemon: [
    'Mega Evolution',
    'Ascended Heroes',
    'Phantasmal Flames',
    'Prismatic Evolution',
    'Destined Rivals',
    'Journey Together',
    'Surging Sparks',
    'Stellar Crown',
    'Twilight Masquerade',
    'Temporal Forces',
    'Paldean Fates',
    'Paradox Rift',
    'Obsidian Flames',
    '151',
    'Crown Zenith',
    'Evolving Skies',
    'VSTAR Universe',
    'VMAX Climax',
    'Shiny Treasure',
    'Clay Burst',
    'Wild Force',
    'Battle Partners',
    'Terastal Festival',
  ],
  yugioh: [
    'Quarter Century',
    'Rarity Collection',
    'Chaos Origins',
    'Alliance Insight',
    'Supreme Darkness',
    'Legacy of Destruction',
    'Phantom Nightmare',
    'Age of Overlord',
    'Duelist Nexus',
    'Maze of Millennia',
    '25th Anniversary',
  ],
  magic: [
    'Final Fantasy',
    'Avatar',
    'Lord of the Rings',
    'Spider-Man',
    'Edge of Eternities',
    'Bloomburrow',
    'Foundations',
    'Modern Horizons 3',
    'Murders at Karlov Manor',
    'Outlaws of Thunder Junction',
    'Duskmourn',
    'Wilds of Eldraine',
    'Tarkir',
    'Aetherdrift',
  ],
  lorcana: [
    'Wilds Unknown',
    'Attack of the Vine',
    'Reign of Jafar',
    'Archazia',
    'Whispers',
    'Fabled',
    'Shimmering Skies',
    'Azurite Sea',
    'Ursula',
    'Into the Inklands',
    'Rise of the Floodborn',
    'First Chapter',
  ],
  onepiece: [
    'The Time of Battle',
    'Adventure on Kami',
    'Carrying On His Will',
    'Legacy of the Master',
    'Two Legends',
    'Emperors in the New World',
    'Wings of the Captain',
    '500 Years',
    'Awakening of the New Era',
    'Kingdoms of Intrigue',
    'Pillars of Strength',
    'Paramount War',
    'Romance Dawn',
  ],
  fleshblood: ['Rosetta', 'Part the Mistveil', 'Heavy Hitters', 'Bright Lights', 'High Seas', 'Dusk till Dawn'],
  dragonball: ['Fusion World', 'Zenkai', 'Ultimate Squad', 'Blazing Aura', 'Realm of the Gods', 'Awakened Pulse'],
  starwars: [
    'Legends of the Force',
    'A Lawless Time',
    'Ashes of the Empire',
    'Jump to Lightspeed',
    'Twilight of the Republic',
    'Shadows of the Galaxy',
    'Spark of Rebellion',
  ],
  digimon: [
    'Dawn of Liberator',
    'Generation',
    'Secret Crisis',
    'Infernal Ascension',
    'Across Time',
    'Blast Ace',
    'Xros Encounter',
    'Alternative Being',
    'Beginning Observer',
    'Draconic Roar',
    'Animal Colosseum',
    'Versus Royal Knights',
    'New Awakening',
    'Exceed Apocalypse',
  ],
  gundam: ['Freedom Ascension', 'Newtype Rising', 'Blaze of Battle', 'Burning', 'GD01', 'GD02', 'GD07'],
};

function popularKeywordsForGame(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('pok')) return POPULAR_EXPANSIONS.pokemon;
  if (n.includes('yu-gi') || n.includes('yugi')) return POPULAR_EXPANSIONS.yugioh;
  if (n.includes('lorcana')) return POPULAR_EXPANSIONS.lorcana;
  if (n.includes('one piece')) return POPULAR_EXPANSIONS.onepiece;
  if (n.includes('flesh')) return POPULAR_EXPANSIONS.fleshblood;
  if (n.includes('dragon ball')) return POPULAR_EXPANSIONS.dragonball;
  if (n.includes('star wars') || n.includes('unlimited')) return POPULAR_EXPANSIONS.starwars;
  if (n.includes('digimon')) return POPULAR_EXPANSIONS.digimon;
  if (n.includes('gundam')) return POPULAR_EXPANSIONS.gundam;
  if (n.includes('magic')) return POPULAR_EXPANSIONS.magic;
  return [];
}

// Category ids that represent actual single cards for a game (as opposed
// to sealed product, boxes, albums, ...), so a card search doesn't return
// booster boxes and binders. Matched by name since the ids differ per
// game; empty result means "couldn't tell" and callers should not filter.
async function singleCardCategoryIds(gameId) {
  const all = config.mockMode
    ? mock.categories
    : unwrapArray(
        await cache.getOrLoad('categories', CATEGORIES_TTL, () => client.get('/categories')),
        'GET /categories'
      );
  return all
    .filter((c) => c.game_id === gameId && /single/i.test(c.name || ''))
    .map((c) => c.id);
}

router.get('/games', async (req, res, next) => {
  try {
    if (config.mockMode) return res.json(mock.games);
    const games = await cache.getOrLoad('games', GAMES_TTL, () => client.get('/games'));
    res.json(unwrapArray(games, 'GET /games'));
  } catch (err) {
    next(err);
  }
});

// Item categories for a game ("Single Cards", "Booster Box", "Album", ...).
router.get('/categories', async (req, res, next) => {
  try {
    const gameId = req.query.game_id ? Number(req.query.game_id) : undefined;

    if (config.mockMode) {
      const list = gameId ? mock.categories.filter((c) => c.game_id === gameId) : mock.categories;
      return res.json(list);
    }

    const all = unwrapArray(
      await cache.getOrLoad('categories', CATEGORIES_TTL, () => client.get('/categories')),
      'GET /categories'
    );
    const list = gameId ? all.filter((c) => c.game_id === gameId) : all;
    // The properties blobs are large and unused by the app.
    res.json(list.map(({ id, name, game_id }) => ({ id, name, game_id })));
  } catch (err) {
    next(err);
  }
});

router.get('/expansions', async (req, res, next) => {
  try {
    const gameId = req.query.game_id ? Number(req.query.game_id) : undefined;

    if (config.mockMode) {
      const list = gameId ? mock.expansions.filter((e) => e.game_id === gameId) : mock.expansions;
      return res.json(list);
    }

    const all = unwrapArray(
      await cache.getOrLoad('expansions', EXPANSIONS_TTL, () => client.get('/expansions')),
      'GET /expansions'
    );
    const list = gameId ? all.filter((e) => e.game_id === gameId) : all;
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// Blueprints (the actual sellable items) for one expansion, with an
// optional case-insensitive substring filter on the name via ?q= and an
// optional ?category_id= filter (single cards vs boxes vs albums, ...).
router.get('/expansions/:id/blueprints', async (req, res, next) => {
  try {
    const expansionId = Number(req.params.id);
    const q = (req.query.q || '').toLowerCase().trim();
    const categoryId = req.query.category_id ? Number(req.query.category_id) : undefined;

    let blueprints;
    if (config.mockMode) {
      blueprints = mock.blueprints.filter((b) => b.expansion_id === expansionId);
    } else {
      blueprints = await getExpansionBlueprints(expansionId);
    }

    let filtered = q ? blueprints.filter((b) => b.name.toLowerCase().includes(q)) : blueprints;
    if (categoryId !== undefined) {
      filtered = filtered.filter((b) => b.category_id === categoryId);
    } else if (req.query.cards_only === 'true') {
      // Keep only real single cards (drop booster boxes, tins, albums, ...).
      // Category ids differ per game, so derive the game from the blueprints
      // themselves; if we can't identify a single-card category, don't hide
      // anything rather than risk showing nothing.
      const gameId = filtered.find((b) => b.game_id)?.game_id;
      if (gameId) {
        const cardCategoryIds = await singleCardCategoryIds(gameId);
        if (cardCategoryIds.length > 0) {
          filtered = filtered.filter((b) => cardCategoryIds.includes(b.category_id));
        }
      }
    }
    res.json(filtered);
  } catch (err) {
    next(err);
  }
});

// Free-text search across every expansion of one game (CardTrader has no
// native global search). Slow-ish on the very first search for a game
// since it has to crawl every expansion's blueprint list, but each
// expansion is cached for 24h afterwards (shared with the per-expansion
// browse endpoint above), so repeat searches are fast.
router.get('/games/:id/search', async (req, res, next) => {
  try {
    const gameId = Number(req.params.id);
    const categoryId = req.query.category_id ? Number(req.query.category_id) : undefined;
    // Default to single cards only — a name search shouldn't return booster
    // boxes, tins and binders that happen to share the name. Pass
    // cards_only=false to widen it.
    const cardsOnly = req.query.cards_only !== 'false';
    const { namePart, numberHint } = parseCardQuery(req.query.q || '');
    if (!namePart && !numberHint) return res.json({ results: [], number_hint: null, expansions_searched: 0 });
    // When a collector number is typed it now FILTERS (not just ranks): only
    // cards whose own collector number matches are returned.
    const numberFilter = parseCollectorNumber(numberHint);
    // Normalized query for accent/case-insensitive and typo-tolerant matching.
    const qNorm = normalizeName(namePart);
    // Lazy prices: when the app will fill "da X€" in afterwards (per visible
    // card, via POST /blueprints/prices), it asks us to SKIP the heavy
    // per-expansion price blobs here — so the first paint is fast and cheap on
    // memory. Results then rank by name relevance instead of price.
    const skipPrices = req.query.prices === 'lazy' || req.query.skip_prices === '1' || req.query.skip_prices === 'true';

    const cardCategoryIds = cardsOnly && categoryId === undefined ? await singleCardCategoryIds(gameId) : [];
    const keepCard = (b) => {
      if (categoryId !== undefined) return b.category_id === categoryId;
      if (cardCategoryIds.length > 0) return cardCategoryIds.includes(b.category_id);
      return true; // couldn't identify a single-card category → don't hide anything
    };

    if (config.mockMode) {
      const results = mock.blueprints
        .filter((b) => b.game_id === gameId &&
          (!qNorm || nameRelevance(b.name, qNorm) > 0 || nameFuzzyMatches(b.name, qNorm)))
        .filter(keepCard)
        .map((b) => {
          const expansion = mock.expansions.find((e) => e.id === b.expansion_id);
          const list = mock.marketplaceProducts[b.id];
          const price = Array.isArray(list) && list.length > 0
            ? list.reduce((min, p) => (p.price.cents < min.price.cents ? p : min)).price
            : undefined;
          return { ...b, expansion_name: expansion?.name, expansion_code: expansion?.code, price };
        })
        .sort((a, b) => (b.price ? b.price.cents : -1) - (a.price ? a.price.cents : -1));
      return res.json({
        results,
        number_hint: numberHint,
        expansions_searched: mock.expansions.length,
        expansions_failed: 0,
      });
    }

    // Cache the whole assembled search result: repeated/popular queries are the
    // main load on the shared token, and the catalog data is identical for
    // everyone regardless of which token fetched it.
    const searchKey = `search:${gameId}:${categoryId ?? 'all'}:${cardsOnly ? 1 : 0}:${skipPrices ? 'np' : 'p'}:${namePart}:${numberHint ?? ''}`;

    // Global crawl limiter. An already-cached or already-in-flight result costs
    // no new crawl, so it's served regardless of the limit. Only a fresh crawl
    // consumes a slot; when both are busy we tell the client to wait rather than
    // start a third memory-heavy crawl. (The cache-check + count read + the
    // loader's increment all run in one synchronous tick, so no request can
    // slip past the cap between the check and the increment.)
    const needsCrawl = cache.get(searchKey) === undefined && !cache.isInFlight(searchKey);
    if (needsCrawl && activeSearches >= MAX_CONCURRENT_SEARCHES) {
      return res.json({
        queued: true,
        retry_after_ms: 2500,
        results: [],
        number_hint: numberHint,
        expansions_searched: 0,
        expansions_failed: 0,
      });
    }

    const payload = await cache.getOrLoad(searchKey, SEARCH_TTL, async () => {
    activeSearches += 1;
    try {
    const allExpansions = unwrapArray(
      await cache.getOrLoad('expansions', EXPANSIONS_TTL, () => client.get('/expansions')),
      'GET /expansions'
    );
    const gameExpansions = allExpansions.filter((e) => e.game_id === gameId);

    let failedExpansions = 0;
    // Concurrency 2 (down from 5/10): each expansion with hits pulls a large
    // marketplace blob for prices, so fewer in flight = lower peak memory
    // (the whole-game crawl was OOM-killing Render's 512 MB free tier). Kept
    // at 2 rather than 3 for extra headroom on a cold cache, when every
    // expansion misses and fetches its blob at once.
    // Client-side retry/backoff keeps it under CardTrader's rate limit so
    // expansions aren't dropped.
    const perExpansion = await mapWithConcurrency(gameExpansions, 2, async (expansion) => {
      try {
        const blueprints = await getExpansionBlueprints(expansion.id);
        const matched = blueprints
          .filter((b) => !qNorm || nameRelevance(b.name, qNorm) > 0 || nameFuzzyMatches(b.name, qNorm))
          .filter((b) => matchesNumber(b, numberFilter))
          .filter(keepCard)
          .map((b) => ({ ...b, expansion_name: expansion.name, expansion_code: expansion.code }));
        // Attach the cheapest listing price so results can be sorted by value.
        // Fetched UNCACHED and freed right away (see cheapestPricesByBlueprint)
        // so a whole-game crawl doesn't cache hundreds of huge blobs and OOM.
        // Skipped for number searches (the number drives the ranking) and for
        // lazy-price requests (the app fills prices in per visible card) — both
        // avoid the heavy per-expansion blob and return much faster.
        if (matched.length > 0 && !numberHint && !skipPrices) {
          try {
            const cheapest = await cheapestPricesByBlueprint(expansion.id);
            for (const b of matched) {
              const price = cheapest[b.id];
              if (price) b.price = price;
            }
          } catch {
            // prices are a nice-to-have; the search still works without them
          }
        }
        return matched;
      } catch {
        failedExpansions += 1; // one bad/rate-limited expansion shouldn't sink the whole search
        return [];
      }
    });

    // Rank by: (optional) typed number first, then cheapest-listing price
    // (highest value first — what people usually want when searching a card),
    // then name relevance, then crawl order.
    let results = perExpansion
      .flat()
      .map((b, i) => ({
        b,
        i,
        hasNumber: numberHint ? b.name.includes(numberHint) : false,
        cents: b.price ? b.price.cents : -1,
        rel: nameRelevance(b.name, qNorm),
      }))
      .sort(
        (a, b) =>
          Number(b.hasNumber) - Number(a.hasNumber) ||
          b.cents - a.cents ||
          b.rel - a.rel ||
          a.i - b.i
      )
      .map((x) => x.b);

      return {
        results: results.slice(0, 400),
        number_hint: numberHint,
        expansions_searched: gameExpansions.length,
        expansions_failed: failedExpansions,
      };
    } finally {
      // Free the slot whether the crawl succeeded or threw, so a failed crawl
      // never permanently shrinks the pool.
      activeSearches -= 1;
    }
    });

    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// Cheapest prices for a specific set of blueprints, so the app can fill in the
// "da X€" labels lazily — only for the cards actually on screen — after a
// fast, price-less (prices=lazy) search. Body: { blueprints: [{id,
// expansion_id}] }. Grouped by expansion so each expansion's cheapest map is
// fetched once (cached/coalesced, heavy blob freed immediately); only the
// requested ids are returned. Returns { "<id>": {cents, currency} }.
router.post('/blueprints/prices', async (req, res, next) => {
  try {
    const wanted = Array.isArray(req.body && req.body.blueprints) ? req.body.blueprints : [];
    if (wanted.length === 0) return res.json({});

    if (config.mockMode) {
      const out = {};
      for (const w of wanted) {
        const list = mock.marketplaceProducts[Number(w && w.id)];
        if (Array.isArray(list) && list.length > 0) {
          out[w.id] = list.reduce((min, p) => (p.price.cents < min.price.cents ? p : min)).price;
        }
      }
      return res.json(out);
    }

    // Group the requested blueprints by expansion (cap the batch so one call
    // can't fan out to hundreds of heavy blobs).
    const byExpansion = new Map();
    for (const w of wanted.slice(0, 300)) {
      const id = Number(w && w.id);
      const expId = Number(w && w.expansion_id);
      if (!id || !expId) continue;
      if (!byExpansion.has(expId)) byExpansion.set(expId, []);
      byExpansion.get(expId).push(id);
    }

    const out = {};
    await mapWithConcurrency([...byExpansion.entries()], 2, async ([expId, ids]) => {
      try {
        const cheapest = await cheapestPricesByBlueprint(expId);
        for (const id of ids) {
          const price = cheapest[id];
          if (price) out[id] = price;
        }
      } catch {
        // A missing price is fine — the card just shows no "da X€".
      }
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// Lightweight name autocomplete for the global search: the top few card names
// matching a partial query, from the (cached, trimmed) blueprint lists — no
// price blobs, so it stays cheap enough to call as the user types. Deduped by
// name (the same card is reprinted across sets). Fuzzy-tolerant like search.
router.get('/games/:id/suggest', async (req, res, next) => {
  try {
    const gameId = Number(req.params.id);
    const { namePart } = parseCardQuery(req.query.q || '');
    const qNorm = normalizeName(namePart);
    if (qNorm.length < 2) return res.json({ suggestions: [] });

    const dedupeTop = (items) => {
      items.sort((a, b) => b.rel - a.rel || a.name.length - b.name.length);
      const seen = new Set();
      const out = [];
      for (const s of items) {
        const key = normalizeName(s.name);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          id: s.id,
          name: s.name,
          expansion_id: s.expansion_id,
          expansion_name: s.expansion_name,
          game_id: gameId,
          image_url: s.image_url,
        });
        if (out.length >= 10) break;
      }
      return out;
    };

    if (config.mockMode) {
      const items = mock.blueprints
        .filter((b) => b.game_id === gameId)
        .map((b) => ({ ...b, rel: nameRelevance(b.name, qNorm), image_url: blueprintImage(b),
          expansion_name: mock.expansions.find((e) => e.id === b.expansion_id)?.name }))
        .filter((b) => b.rel > 0 || nameFuzzyMatches(b.name, qNorm));
      return res.json({ suggestions: dedupeTop(items) });
    }

    const cacheKey = `suggest:${gameId}:${qNorm}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return res.json(cached);

    const allExpansions = unwrapArray(
      await cache.getOrLoad('expansions', EXPANSIONS_TTL, () => client.get('/expansions')),
      'GET /expansions'
    );
    const gameExpansions = allExpansions.filter((e) => e.game_id === gameId);
    const cardCategoryIds = await singleCardCategoryIds(gameId);
    const keepCard = (b) => cardCategoryIds.length === 0 || cardCategoryIds.includes(b.category_id);

    const per = await mapWithConcurrency(gameExpansions, 2, async (expansion) => {
      try {
        const blueprints = await getExpansionBlueprints(expansion.id);
        const out = [];
        for (const b of blueprints) {
          if (!keepCard(b)) continue;
          const rel = nameRelevance(b.name, qNorm);
          if (rel <= 0 && !nameFuzzyMatches(b.name, qNorm)) continue;
          out.push({
            id: b.id,
            name: b.name,
            rel,
            expansion_id: expansion.id,
            expansion_name: expansion.name,
            image_url: b.image_url,
          });
        }
        return out;
      } catch {
        return [];
      }
    });

    const payload = { suggestions: dedupeTop(per.flat()) };
    cache.set(cacheKey, payload, SEARCH_TTL);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// Prewarm the name-search cache for a game: crawl every expansion's (trimmed,
// cached) blueprint list so the FIRST user search finds a warm cache and
// returns instantly instead of paying for the whole-game crawl. No price
// blobs are fetched, so it's memory-light — meant to be pinged by the
// scheduled cron so cold-cache first searches are rare. (After a Render
// restart the cache is cold until the next cron warm or the first user
// search; this just makes that window small.)
async function warmGameNameCache(gameId) {
  const allExpansions = unwrapArray(
    await cache.getOrLoad('expansions', EXPANSIONS_TTL, () => client.get('/expansions')),
    'GET /expansions'
  );
  const gameExpansions = allExpansions.filter((e) => e.game_id === gameId);

  let warmed = 0;
  let failed = 0;
  // Concurrency 3: blueprint lists are small trimmed objects (no heavy price
  // blobs), so this stays light on memory even for an 850-expansion game.
  await mapWithConcurrency(gameExpansions, 3, async (exp) => {
    try {
      await getExpansionBlueprints(exp.id);
      warmed += 1;
    } catch {
      failed += 1;
    }
  });
  return { expansions: gameExpansions.length, warmed, failed };
}

router.get('/games/:id/warm', async (req, res, next) => {
  try {
    const gameId = Number(req.params.id);
    if (!gameId || config.mockMode) return res.json({ ok: true, warmed: 0 });
    const result = await warmGameNameCache(gameId);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// Warm the name cache for the supported games (Pokémon, One Piece) once, in the
// background — called on server startup so the cache is warm again shortly
// after a Render restart, without waiting up to 6h for the next cron warm.
// Sequential across games and best-effort: never throws, never blocks boot.
async function warmSupportedGames() {
  if (config.mockMode) return;
  try {
    const games = unwrapArray(
      await cache.getOrLoad('games', GAMES_TTL, () => client.get('/games')),
      'GET /games'
    );
    const supported = games.filter((g) => {
      const n = (g.display_name || g.name || '').toLowerCase();
      return n.includes('pok') || n.includes('one piece');
    });
    for (const g of supported) {
      try {
        const r = await warmGameNameCache(g.id);
        console.log(`[warm] game ${g.id} (${g.display_name || g.name}): ${r.warmed}/${r.expansions} expansions cached`);
      } catch (e) {
        console.warn(`[warm] game ${g.id} failed: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(`[warm] startup warm skipped: ${e.message}`);
  }
}

// Cheapest listing price per blueprint across a whole expansion, for
// "starting from X" labels and price sorting in the card list — one call
// via marketplace/products?expansion_id= instead of one per card.
router.get('/expansions/:id/prices', async (req, res, next) => {
  try {
    const expansionId = Number(req.params.id);
    // Shares the cached small price map with search and highlights.
    res.json(await cheapestPricesByBlueprint(expansionId));
  } catch (err) {
    next(err);
  }
});

// Home "highlights" for a game: the hand-curated most-requested expansions
// (see POPULAR_EXPANSIONS), each covered by its CHASE CARD (the priciest
// single — never a box), plus the priciest singles across them ("le più
// ambite"). Games without a curated list fall back to newest main sets.
//
// Memory matters (a whole expansion's marketplace/products payload is large,
// and loading many at once OOM-killed Render — exit 134): the heavy products
// call runs at concurrency 2, UNCACHED so each big blob is freed right after
// we extract the small summary. The whole result is cached for hours.
router.get('/games/:id/highlights', async (req, res, next) => {
  try {
    const gameId = Number(req.params.id);
    if (!gameId) return res.json({ expansions: [], chase: [] });

    // ?refresh=1 bypasses the 6h cache (manual "refresh" from the home) and
    // recomputes, then refreshes the cache for everyone else.
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const cacheKey = `highlights:${gameId}`;
    if (!refresh) {
      const cached = cache.get(cacheKey);
      if (cached !== undefined) return res.json(cached);
    }

    const allExpansions = config.mockMode
      ? mock.expansions
      : unwrapArray(
          await cache.getOrLoad('expansions', EXPANSIONS_TTL, () => client.get('/expansions')),
          'GET /expansions'
        );
    const games = config.mockMode
      ? mock.games
      : unwrapArray(await cache.getOrLoad('games', GAMES_TTL, () => client.get('/games')), 'GET /games');

    const gameExpansions = allExpansions.filter((e) => e.game_id === gameId);
    if (gameExpansions.length === 0) return res.json({ expansions: [], chase: [] });

    const game = games.find((g) => g.id === gameId);
    const keywords = popularKeywordsForGame(game ? game.display_name || game.name : '');

    // Resolve curated keywords against real expansion names, in priority
    // order, taking ALL matches per keyword so English and Japanese/Chinese
    // printings of a set both show up. Then top up with newest main sets so
    // nothing is ever empty.
    const MAX_SETS = 6;
    const selected = [];
    const seen = new Set();
    const add = (e) => {
      if (seen.has(e.id) || selected.length >= MAX_SETS) return;
      selected.push(e);
      seen.add(e.id);
    };
    for (const kw of keywords) {
      const low = kw.toLowerCase();
      // Main-set candidates for this keyword (never a promo/energy/products/
      // reverse sub-set), preferring the one with the shortest name — i.e. the
      // base set "Mega Evolution", not "Mega Evolution Products/Energies".
      const matches = gameExpansions
        .filter((e) => !isMinorSet(e.name) && (e.name || '').toLowerCase().includes(low))
        .sort((a, b) => (a.name || '').length - (b.name || '').length);
      if (matches.length > 0) add(matches[0]);
      if (selected.length >= MAX_SETS) break;
    }
    if (selected.length < MAX_SETS) {
      const newestMain = gameExpansions
        .filter((e) => !seen.has(e.id) && !isMinorSet(e.name))
        .sort((a, b) => b.id - a.id);
      for (const e of newestMain) add(e);
    }
    if (selected.length === 0) return res.json({ expansions: [], chase: [] });

    const cardCategoryIds = await singleCardCategoryIds(gameId);

    // Per set: reuse the shared, cached small price map (the heavy marketplace
    // blob is fetched+reduced+freed inside cheapestPricesByBlueprint, and the
    // tiny result is cached, so a warm cache makes this near-instant — same
    // speedup the search got). Concurrency 1 (truly sequential): only ONE big
    // marketplace blob is ever parsed in memory at a time, so the 6-hourly
    // recompute can't spike past the 512 MB free-tier limit (it was OOM-killing
    // Render at ~4am when the price-cron warmed the cache). It's a background
    // job cached for hours, so being a few seconds slower is free.
    const perExpansion = await mapWithConcurrency(selected, 1, async (exp) => {
      try {
        const cheapestByBp = await cheapestPricesByBlueprint(exp.id);

        const blueprints = config.mockMode
          ? mock.blueprints.filter((b) => b.expansion_id === exp.id)
          : await getExpansionBlueprints(exp.id);

        const cards = [];
        for (const bp of blueprints) {
          const price = cheapestByBp[bp.id];
          if (!price) continue;
          // Single cards only (category + name safety net) — never a box.
          if (cardCategoryIds.length > 0 && !cardCategoryIds.includes(bp.category_id)) continue;
          if (looksSealedCard(bp.name)) continue;
          cards.push({
            blueprint_id: bp.id,
            name: bp.name,
            image_url: blueprintImage(bp),
            game_id: bp.game_id,
            expansion_id: exp.id,
            expansion_name: exp.name,
            price,
          });
        }
        cards.sort((a, b) => b.price.cents - a.price.cents);
        return { exp, cards };
      } catch {
        return { exp, cards: [] };
      }
    });

    // Cover = the priciest single card WITH an image (the chase card); if a
    // set has none, cover stays null and the app shows a placeholder.
    const expansions = perExpansion.map(({ exp, cards }) => {
      const coverCard = cards.find((c) => c.image_url);
      return {
        id: exp.id,
        name: exp.name,
        code: exp.code,
        cover_image_url: coverCard ? coverCard.image_url : null,
        top_price: cards.length > 0 ? cards[0].price : null,
      };
    });

    // "Le più ambite": the priciest singles across the curated sets.
    const chase = perExpansion
      .flatMap((p) => p.cards)
      .sort((a, b) => b.price.cents - a.price.cents)
      .slice(0, 15);

    const result = { expansions, chase };
    cache.set(cacheKey, result, HIGHLIGHTS_TTL);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Resolve collector numbers for a batch of blueprints (id + game_id +
// expansion name), so the app can backfill the number on cards saved before we
// started storing it. Groups by expansion to reuse the (cached, trimmed)
// blueprint lists. Body: { blueprints: [{ id, game_id, expansion }] }.
// Returns { "<id>": "025/165", ... } for the ones we could resolve.
router.post('/blueprints/numbers', async (req, res, next) => {
  try {
    const wanted = Array.isArray(req.body && req.body.blueprints) ? req.body.blueprints : [];
    if (wanted.length === 0 || config.mockMode) return res.json({});

    const allExpansions = unwrapArray(
      await cache.getOrLoad('expansions', EXPANSIONS_TTL, () => client.get('/expansions')),
      'GET /expansions'
    );

    const out = {};
    const byExpansion = new Map(); // expansionId -> trimmed blueprint list
    for (const w of wanted.slice(0, 2000)) {
      const id = Number(w && w.id);
      if (!id) continue;
      const gameId = w.game_id ? Number(w.game_id) : undefined;
      const expName = (w.expansion || '').toLowerCase().trim();
      const candidates = allExpansions.filter((e) => (gameId ? e.game_id === gameId : true));
      const exp = expName
        ? candidates.find((e) => (e.name || '').toLowerCase() === expName) ||
          candidates.find((e) => (e.name || '').toLowerCase().includes(expName))
        : null;
      if (!exp) continue;
      let bps = byExpansion.get(exp.id);
      if (!bps) {
        try {
          bps = await getExpansionBlueprints(exp.id);
          byExpansion.set(exp.id, bps);
        } catch {
          continue;
        }
      }
      const bp = bps.find((b) => b.id === id);
      const num = bp && bp.fixed_properties && displayCollectorNumber(bp.fixed_properties.collector_number);
      if (num) out[id] = num;
    }
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// Best-effort image URL for a single blueprint, by id. Order and cart
// items carry no card image (confirmed from real payloads), only a
// blueprint id + expansion name, so the app resolves thumbnails through
// here. Uses the game's expansion list + that expansion's blueprint
// export (both already cached for browsing) to find the blueprint's
// image, and caches the resolved URL. Returns null rather than erroring
// when it can't find one, so a missing image never breaks the UI.
router.get('/blueprints/:id/image', async (req, res, next) => {
  try {
    const blueprintId = Number(req.params.id);
    const gameId = req.query.game_id ? Number(req.query.game_id) : undefined;
    const expansionName = (req.query.expansion || '').toLowerCase().trim();
    if (!blueprintId) return res.json({ image_url: null });

    const cacheKey = `bp-image:${blueprintId}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return res.json({ image_url: cached });

    const imageOf = blueprintImage;

    if (config.mockMode) {
      const bp = mock.blueprints.find((b) => b.id === blueprintId);
      const url = imageOf(bp);
      cache.set(cacheKey, url, BLUEPRINTS_TTL);
      return res.json({ image_url: url });
    }

    const allExpansions = unwrapArray(
      await cache.getOrLoad('expansions', EXPANSIONS_TTL, () => client.get('/expansions')),
      'GET /expansions'
    );
    const candidates = allExpansions.filter((e) => (gameId ? e.game_id === gameId : true));
    const expansion = (expansionName
      ? candidates.find((e) => (e.name || '').toLowerCase() === expansionName) ||
        candidates.find((e) => (e.name || '').toLowerCase().includes(expansionName))
      : null);

    let url = null;
    if (expansion) {
      const blueprints = await getExpansionBlueprints(expansion.id);
      url = imageOf(blueprints.find((b) => b.id === blueprintId));
    }
    cache.set(cacheKey, url, BLUEPRINTS_TTL);
    res.json({ image_url: url });
  } catch (err) {
    next(err);
  }
});

// Marketplace listings (real, purchasable Products) for one blueprint.
router.get('/blueprints/:id/products', async (req, res, next) => {
  try {
    const blueprintId = Number(req.params.id);

    if (config.mockMode) {
      return res.json(mock.marketplaceProducts[blueprintId] || []);
    }

    const params = { blueprint_id: blueprintId };
    if (req.query.foil !== undefined) params.foil = req.query.foil;
    if (req.query.language) params.language = req.query.language;

    const data = await cache.getOrLoad(
      `products:${blueprintId}:${JSON.stringify(params)}`,
      PRODUCTS_TTL,
      () => client.get('/marketplace/products', params)
    );
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(
        `Unexpected response from CardTrader for GET /marketplace/products: ${JSON.stringify(data).slice(0, 500)}`
      );
    }
    res.json(data[String(blueprintId)] || []);
  } catch (err) {
    next(err);
  }
});

// Price history for a blueprint. CardTrader's API exposes no historical prices,
// so we build our own: each time a card's page is opened we record ONE point
// per day (the cheapest current listing) in Firestore, capped to the last
// PRICE_HISTORY_MAX days. Returns the stored series; the app derives min/max
// and draws the trend. Needs Firebase configured — otherwise returns empty.
const PRICE_HISTORY_MAX = 120;

router.get('/blueprints/:id/history', async (req, res, next) => {
  try {
    const blueprintId = Number(req.params.id);
    if (!blueprintId || config.mockMode || !firestore) return res.json({ points: [] });

    const ref = firestore.collection('priceHistory').doc(String(blueprintId));
    const snap = await ref.get();
    let points = snap.exists && Array.isArray(snap.data().points) ? snap.data().points : [];

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const hasToday = points.length > 0 && points[points.length - 1].d === today;

    if (!hasToday) {
      // Record today's cheapest listing for this blueprint — one targeted,
      // cheap call (just this blueprint's listings, not a whole-expansion blob).
      try {
        const data = await cache.getOrLoad(
          `bp-cheapest:${blueprintId}`,
          PRODUCTS_TTL,
          () => client.get('/marketplace/products', { blueprint_id: blueprintId })
        );
        const list = (data && data[String(blueprintId)]) || [];
        let minCents = null;
        let currency = 'EUR';
        for (const p of list) {
          const c = p && p.price && p.price.cents;
          if (typeof c === 'number' && (minCents === null || c < minCents)) {
            minCents = c;
            currency = (p.price && p.price.currency) || currency;
          }
        }
        if (minCents !== null) {
          points = [...points, { d: today, c: minCents, cur: currency }].slice(-PRICE_HISTORY_MAX);
          await ref.set({ points, updatedAt: Date.now() }, { merge: true });
        }
      } catch {
        // Recording is best-effort — return whatever history we already have.
      }
    }

    res.json({ points });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.warmSupportedGames = warmSupportedGames;
