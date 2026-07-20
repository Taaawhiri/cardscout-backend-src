const express = require('express');
const config = require('../config');
const client = require('../cardtraderClient');
const mock = require('../mockData');

const router = express.Router();

function unwrapList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.array)) return value.array;
  if (Array.isArray(value?.orders)) return value.orders;
  return null;
}

// CardTrader's docs don't pin down where the shipment tracking number
// lives on an Order, so probe the plausible spots.
function findTrackingCode(order) {
  return (
    order.tracking_code ||
    order.shipping_tracking_code ||
    order.order_shipping_method?.tracking_code ||
    order.order_shipping_method?.tracking_number ||
    null
  );
}

// Adds tracking_code and a ready-to-open tracking_url (the shipping
// method's tracking_link has a {code} placeholder per the API docs).
function normalizeOrder(order) {
  const method = order.order_shipping_method || {};
  const code = findTrackingCode(order);
  const link = method.tracking_link;
  return {
    ...order,
    tracking_code: code,
    tracking_url: code && link ? String(link).replace('{code}', code) : null,
  };
}

router.get('/', async (req, res, next) => {
  try {
    if (config.mockMode) {
      return res.json(mock.orders.map(normalizeOrder));
    }

    const params = { order_as: req.query.order_as || 'buyer' };
    if (req.query.state) params.state = req.query.state;
    if (req.query.page) params.page = req.query.page;
    if (req.query.limit) params.limit = req.query.limit;

    const data = await client.get('/orders', params);
    const list = unwrapList(data);
    if (!list) {
      throw new Error(`Unexpected response from CardTrader for GET /orders: ${JSON.stringify(data).slice(0, 500)}`);
    }
    res.json(list.map(normalizeOrder));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (config.mockMode) {
      const order = mock.orders.find((o) => String(o.id) === req.params.id || o.code === req.params.id);
      if (!order) return res.status(404).json({ error: 'not_found' });
      return res.json(normalizeOrder(order));
    }

    const data = await client.get(`/orders/${req.params.id}`);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(`Unexpected response from CardTrader for GET /orders/:id: ${JSON.stringify(data).slice(0, 500)}`);
    }
    res.json(normalizeOrder(data));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
