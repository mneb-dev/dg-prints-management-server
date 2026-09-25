import { Router } from 'express';

import { getProduct, listProducts } from '../data/productStore.js';
import { getSettings } from '../data/settingsStore.js';
import { isShopVisible, toShopProduct, type ShopSettings } from '../types/shop.js';
import { toMessengerUrl } from '../utils/messengerUrl.js';
import { PROVINCES } from '../utils/phProvinces.js';
import { isUuid } from '../utils/uuid.js';
import { parsePage, parsePageSize, parseSortBy, parseSortDir, queryString } from './pagination.js';

// Public, unauthenticated endpoints for the online shop. Visibility (showInShop, not deleted)
// is forced here on the server so a client can never widen it via query params. Inactive
// products are included and flagged `inStock: false` so the shop can show "Out of stock".
const router = Router();

const SHOP_SORT_KEYS = ['name', 'created_at'] as const;

router.get('/products', async (req, res, next) => {
  try {
    const pageSize = parsePageSize(req.query.pageSize);
    if (typeof pageSize !== 'number') {
      res.status(400).json({ error: pageSize.error });
      return;
    }
    const result = await listProducts({
      page: parsePage(req.query.page),
      pageSize,
      search: queryString(req.query.search),
      category: queryString(req.query.category),
      showInShop: true,
      sortBy: parseSortBy(req.query.sortBy, SHOP_SORT_KEYS, 'name'),
      sortDir: req.query.sortDir === undefined ? 'asc' : parseSortDir(req.query.sortDir),
    });
    res.json({ ...result, items: result.items.map(toShopProduct) });
  } catch (err) {
    next(err);
  }
});

router.get('/products/:id', async (req, res, next) => {
  try {
    const product = isUuid(req.params.id) ? await getProduct(req.params.id) : undefined;
    if (!product || !isShopVisible(product)) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json(toShopProduct(product));
  } catch (err) {
    next(err);
  }
});

router.get('/categories', async (_req, res, next) => {
  try {
    const { items } = await listProducts({
      page: 1,
      pageSize: null,
      showInShop: true,
      sortBy: 'category',
      sortDir: 'asc',
    });
    const categories = [...new Set(items.map((product) => product.category).filter(Boolean))];
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

router.get('/settings', async (_req, res, next) => {
  try {
    const { messengerUrl } = await getSettings();
    // Also converted on read, for links saved before conversion existed.
    const settings: ShopSettings = { messengerUrl: toMessengerUrl(messengerUrl) };
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// Checkout's shipping data: fee per island group + every province and its group.
router.get('/shipping', async (_req, res, next) => {
  try {
    const { shippingRates } = await getSettings();
    res.json({ rates: shippingRates, provinces: PROVINCES });
  } catch (err) {
    next(err);
  }
});

export default router;
