const { AsyncLocalStorage } = require('node:async_hooks');

// Carries a per-request CardTrader token (from a linked user) through the async
// call chain, so cardtraderClient.get can use it instead of the shared token
// without threading it through every function. Absent context = shared token.
const tokenContext = new AsyncLocalStorage();

// Express middleware: if the request carries a personal CardTrader token, run
// the rest of the handler with that token in context.
function withUserToken(req, res, next) {
  const raw = req.headers['x-cardtrader-token'];
  const token = typeof raw === 'string' ? raw.trim() : '';
  if (token) {
    tokenContext.run({ token }, () => next());
  } else {
    next();
  }
}

module.exports = { tokenContext, withUserToken };
