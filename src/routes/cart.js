const express = require('express');
const config = require('../config');
const client = require('../cardtraderClient');

const router = express.Router();

// --- Mock mode: a simple in-memory cart so the app is testable without a token ---
let mockCart = {
  id: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  subcarts: [],
  subtotal: { cents: 0, currency: 'EUR' },
  shipping_cost: { cents: 0, currency: 'EUR' },
  billing_address: null,
  shipping_address: null,
};

function mockRecalcSubtotal() {
  const cents = mockCart.subcarts.reduce(
    (sum, sc) => sum + sc.cart_items.reduce((s, it) => s + it.price_cents * it.quantity, 0),
    0
  );
  mockCart.subtotal = { cents, currency: 'EUR' };
  mockCart.updated_at = new Date().toISOString();
}

router.get('/', async (req, res, next) => {
  try {
    if (config.mockMode) return res.json(mockCart);
    const cart = await client.get('/cart');
    res.json(cart);
  } catch (err) {
    next(err);
  }
});

router.post('/add', async (req, res, next) => {
  try {
    const { product_id, quantity, via_cardtrader_zero, billing_address, shipping_address } = req.body;

    if (!product_id || !quantity) {
      return res.status(400).json({ error: 'product_id and quantity are required' });
    }

    if (config.mockMode) {
      const mock = require('../mockData');
      const allProducts = Object.values(mock.marketplaceProducts).flat();
      const product = allProducts.find((p) => p.id === product_id);
      if (!product) return res.status(404).json({ error: 'Unknown mock product_id' });

      let subcart = mockCart.subcarts.find((sc) => sc.seller.id === product.user.id);
      if (!subcart) {
        subcart = {
          id: mockCart.subcarts.length + 1,
          seller: { id: product.user.id, username: product.user.username },
          cart_items: [],
          shipping_cost: { cents: 390, currency: 'EUR' },
        };
        mockCart.subcarts.push(subcart);
      }
      subcart.cart_items.push({
        quantity,
        price_cents: product.price.cents,
        price_currency: product.price.currency,
        product: { id: product.id, name_en: product.name_en },
      });
      if (billing_address) mockCart.billing_address = billing_address;
      if (shipping_address) mockCart.shipping_address = shipping_address;
      mockRecalcSubtotal();
      return res.json(mockCart);
    }

    const cart = await client.post('/cart/add', {
      product_id,
      quantity,
      via_cardtrader_zero,
      billing_address,
      shipping_address,
    });
    res.json(cart);
  } catch (err) {
    next(err);
  }
});

router.post('/remove', async (req, res, next) => {
  try {
    const { product_id, quantity } = req.body;
    if (!product_id || !quantity) {
      return res.status(400).json({ error: 'product_id and quantity are required' });
    }

    if (config.mockMode) {
      for (const subcart of mockCart.subcarts) {
        const idx = subcart.cart_items.findIndex((it) => it.product.id === product_id);
        if (idx !== -1) {
          subcart.cart_items[idx].quantity -= quantity;
          if (subcart.cart_items[idx].quantity <= 0) subcart.cart_items.splice(idx, 1);
        }
      }
      mockCart.subcarts = mockCart.subcarts.filter((sc) => sc.cart_items.length > 0);
      mockRecalcSubtotal();
      return res.json(mockCart);
    }

    const cart = await client.post('/cart/remove', { product_id, quantity });
    res.json(cart);
  } catch (err) {
    next(err);
  }
});

// Purchasing spends real money on the buyer's real CardTrader account, so
// this route requires an explicit `confirm: true` in the body on top of
// whatever confirmation the client UI already did — belt and suspenders.
router.post('/purchase', async (req, res, next) => {
  try {
    if (req.body?.confirm !== true) {
      return res.status(400).json({
        error: 'confirmation_required',
        message: 'Resend this request with { "confirm": true } to finalize the real purchase.',
      });
    }

    if (config.mockMode) {
      const order = {
        order_as: 'buyer',
        id: null,
        code: `MOCK-${Date.now()}`,
        state: 'pending',
        total: mockCart.subtotal,
        subcarts: mockCart.subcarts,
      };
      mockCart = {
        ...mockCart,
        subcarts: [],
        subtotal: { cents: 0, currency: 'EUR' },
      };
      return res.json([order]);
    }

    const order = await client.post('/cart/purchase');
    res.json(order);
  } catch (err) {
    next(err);
  }
});

router.get('/shipping-methods', async (req, res, next) => {
  try {
    if (!req.query.username) {
      return res.status(400).json({ error: 'username is required' });
    }
    if (config.mockMode) {
      return res.json([
        {
          id: 1,
          name: 'Standard',
          min_estimate_shipping_days: 3,
          max_estimate_shipping_days: 7,
          parcel: true,
          tracked: false,
        },
        {
          id: 2,
          name: 'Corriere Espresso',
          min_estimate_shipping_days: 1,
          max_estimate_shipping_days: 3,
          parcel: true,
          tracked: true,
        },
      ]);
    }
    const methods = await client.get('/shipping_methods', { username: req.query.username });
    res.json(methods);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
