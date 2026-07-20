require('dotenv').config();

const token = process.env.CARDTRADER_TOKEN || '';

// How many DISTINCT whole-game search crawls may run at once across all
// requests (the global memory safety valve — see catalog.js). Scale it to the
// instance's RAM: 2 fits the 512 MB free/Starter tier; bump it (e.g. 6) on a
// 2 GB Standard instance straight from the Render dashboard, no redeploy. A
// bad/zero value falls back to the safe default.
const parsedMaxSearches = parseInt(process.env.MAX_CONCURRENT_SEARCHES, 10);

module.exports = {
  port: process.env.PORT || 3000,
  cardtraderBaseUrl: process.env.CARDTRADER_BASE_URL || 'https://api.cardtrader.com/api/v2',
  cardtraderToken: token,
  mockMode: token.length === 0,
  maxConcurrentSearches: Number.isInteger(parsedMaxSearches) && parsedMaxSearches > 0 ? parsedMaxSearches : 2,
};
