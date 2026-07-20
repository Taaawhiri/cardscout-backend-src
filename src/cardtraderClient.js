const axios = require('axios');
const config = require('./config');
const { tokenContext } = require('./requestContext');

const http = axios.create({
  baseURL: config.cardtraderBaseUrl,
  timeout: 10000,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The token for this call: a linked user's personal token when present in the
// async context, otherwise the app's shared token. Read-only catalog data is
// identical either way — this just spreads rate-limit load off the shared key.
function authHeaders() {
  const token = tokenContext.getStore()?.token || config.cardtraderToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// CardTrader rate-limits at ~200 requests / 10s overall. A whole-game crawl
// (hundreds of expansions) inevitably brushes that limit, and a dropped
// expansion means missing search results. So retry transient failures —
// 429 (rate limited), 5xx, and network/timeout errors — with exponential
// backoff, honouring a Retry-After header when present.
async function get(path, params, { retries = 3 } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      const { data } = await http.get(path, { params, headers: authHeaders() });
      return data;
    } catch (err) {
      const status = err.response?.status;
      const retriable =
        status === 429 ||
        status === 503 ||
        (typeof status === 'number' && status >= 500) ||
        err.code === 'ECONNABORTED' || // axios timeout
        !err.response; // network error, no response
      if (!retriable || attempt >= retries) throw err;
      const retryAfter = Number(err.response?.headers?.['retry-after']);
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(1000 * 2 ** attempt, 8000);
      await sleep(waitMs);
      attempt += 1;
    }
  }
}

async function post(path, body) {
  const { data } = await http.post(path, body, { headers: authHeaders() });
  return data;
}

module.exports = { http, get, post };
