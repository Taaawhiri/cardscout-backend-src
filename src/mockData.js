// Fixture data used when CARDTRADER_TOKEN is not set, so the app is
// testable end-to-end before real credentials are configured.

const games = [
  { id: 1, name: 'Magic', display_name: 'Magic: the Gathering' },
];

const categories = [
  { id: 1, name: 'Magic Single Card', game_id: 1 },
  { id: 2, name: 'Booster Box', game_id: 1 },
  { id: 3, name: 'Album', game_id: 1 },
];

const expansions = [
  { id: 8, game_id: 1, code: 'c18', name: 'Commander 2018' },
  { id: 74, game_id: 1, code: 'ugl', name: 'Unglued' },
];

const blueprints = [
  {
    id: 327,
    name: 'Brainstorm',
    version: null,
    game_id: 1,
    category_id: 1,
    expansion_id: 8,
    image_url: null,
    scryfall_id: 'mock-brainstorm',
  },
  {
    id: 89,
    name: 'Beast // Plant',
    version: null,
    game_id: 1,
    category_id: 1,
    expansion_id: 8,
    image_url: null,
    scryfall_id: 'mock-beastplant',
  },
  {
    id: 501,
    name: 'Chaos Orb',
    version: null,
    game_id: 1,
    category_id: 1,
    expansion_id: 74,
    image_url: null,
    scryfall_id: 'mock-chaosorb',
  },
  {
    id: 601,
    name: 'Commander 2018 - Booster Box',
    version: null,
    game_id: 1,
    category_id: 2,
    expansion_id: 8,
    image_url: null,
    scryfall_id: null,
  },
  {
    id: 602,
    name: 'Album Premium 360 tasche',
    version: null,
    game_id: 1,
    category_id: 3,
    expansion_id: 8,
    image_url: null,
    scryfall_id: null,
  },
];

const marketplaceProducts = {
  327: [
    {
      id: 110419919,
      blueprint_id: 327,
      name_en: 'Brainstorm',
      quantity: 3,
      price: { cents: 40, currency: 'EUR' },
      description: 'Near mint, English',
      properties_hash: { condition: 'Near Mint', mtg_foil: false, mtg_language: 'English' },
      expansion: expansions[0],
      user: {
        id: 34089,
        username: 'CT Connect',
        can_sell_via_hub: true,
        country_code: 'IT',
        user_type: 'professional',
        max_sellable_in24h_quantity: 100,
      },
      graded: false,
      on_vacation: false,
      bundle_size: 1,
    },
  ],
  89: [
    {
      id: 110419920,
      blueprint_id: 89,
      name_en: 'Beast // Plant',
      quantity: 1,
      price: { cents: 25, currency: 'EUR' },
      description: 'Slightly played',
      properties_hash: { condition: 'Slightly Played', mtg_foil: false, mtg_language: 'Italian' },
      expansion: expansions[0],
      user: {
        id: 55123,
        username: 'mock_seller',
        can_sell_via_hub: false,
        country_code: 'IT',
        user_type: 'normal',
        max_sellable_in24h_quantity: 10,
      },
      graded: false,
      on_vacation: false,
      bundle_size: 1,
    },
  ],
  501: [
    {
      id: 110419921,
      blueprint_id: 501,
      name_en: 'Chaos Orb',
      quantity: 1,
      price: { cents: 1500, currency: 'EUR' },
      description: 'Mint',
      properties_hash: { condition: 'Mint', mtg_foil: true, mtg_language: 'English' },
      expansion: expansions[1],
      user: {
        id: 55124,
        username: 'mock_seller_2',
        can_sell_via_hub: true,
        country_code: 'IT',
        user_type: 'professional',
        max_sellable_in24h_quantity: 5,
      },
      graded: false,
      on_vacation: false,
      bundle_size: 1,
    },
  ],
};

const orders = [
  {
    id: 9001,
    order_as: 'buyer',
    code: 'CT-2026-0001',
    state: 'sent',
    size: 2,
    via_cardtrader_zero: true,
    seller: { id: 34089, username: 'CT Connect' },
    paid_at: '2026-07-10T09:15:00.000Z',
    sent_at: '2026-07-12T14:30:00.000Z',
    cancelled_at: null,
    total: { cents: 1540, currency: 'EUR' },
    buyer_total: { cents: 1540, currency: 'EUR' },
    formatted_total: '15.40 EUR',
    tracking_code: 'AB123456789IT',
    order_shipping_method: {
      name: 'CardTrader Zero - Tracciata',
      tracked: true,
      tracking_link: 'https://www.poste.it/cerca/index.html#/risultati-spedizioni/{code}',
    },
    order_items: [
      { id: 110419921, quantity: 1, name_en: 'Chaos Orb', price_cents: 1500, price_currency: 'EUR', image_url: null },
      { id: 110419919, quantity: 1, name_en: 'Brainstorm', price_cents: 40, price_currency: 'EUR', image_url: null },
    ],
  },
  {
    id: 9002,
    order_as: 'buyer',
    code: 'CT-2026-0002',
    state: 'paid',
    size: 1,
    via_cardtrader_zero: false,
    seller: { id: 55123, username: 'mock_seller' },
    paid_at: '2026-07-14T18:05:00.000Z',
    sent_at: null,
    cancelled_at: null,
    total: { cents: 25, currency: 'EUR' },
    buyer_total: { cents: 25, currency: 'EUR' },
    formatted_total: '0.25 EUR',
    order_shipping_method: {
      name: 'Posta ordinaria',
      tracked: false,
      tracking_link: null,
    },
    order_items: [
      { id: 110419920, quantity: 1, name_en: 'Beast // Plant', price_cents: 25, price_currency: 'EUR', image_url: null },
    ],
  },
  {
    id: 9004,
    order_as: 'buyer',
    code: 'CT-2026-0004',
    state: 'paid',
    size: 1,
    via_cardtrader_zero: true,
    seller: { id: 34089, username: 'CT Connect' },
    paid_at: '2026-07-15T08:00:00.000Z',
    sent_at: null,
    cancelled_at: null,
    total: { cents: 1500, currency: 'EUR' },
    buyer_total: { cents: 1500, currency: 'EUR' },
    formatted_total: '15.00 EUR',
    order_shipping_method: {
      name: 'CardTrader Zero - Tracciata',
      tracked: true,
      tracking_link: 'https://www.poste.it/cerca/index.html#/risultati-spedizioni/{code}',
    },
    order_items: [
      { id: 110419921, quantity: 1, name_en: 'Chaos Orb', price_cents: 1500, price_currency: 'EUR', image_url: null },
    ],
  },
  {
    id: 9003,
    order_as: 'buyer',
    code: 'CT-2026-0003',
    state: 'cancelled',
    size: 1,
    via_cardtrader_zero: true,
    seller: { id: 34089, username: 'CT Connect' },
    paid_at: null,
    sent_at: null,
    cancelled_at: '2026-07-08T10:00:00.000Z',
    total: { cents: 40, currency: 'EUR' },
    buyer_total: { cents: 40, currency: 'EUR' },
    formatted_total: '0.40 EUR',
    order_shipping_method: null,
    order_items: [
      { id: 110419919, quantity: 1, name_en: 'Brainstorm', price_cents: 40, price_currency: 'EUR', image_url: null },
    ],
  },
];

module.exports = { games, categories, expansions, blueprints, marketplaceProducts, orders };
