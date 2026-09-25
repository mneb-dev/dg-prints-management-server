import { Router } from 'express';

import { getProduct, listProducts } from '../data/productStore.js';
import { isShopVisible, toShopProduct } from '../types/shop.js';
import { isUuid } from '../utils/uuid.js';
import { parsePage, parsePageSize, parseSortBy, parseSortDir, queryString } from './pagination.js';

// Public, unauthenticated endpoints for the online shop. Visibility (Active + showInShop)
// is forced here on the server so a client can never widen it via query params.
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
      status: 'Active',
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
      status: 'Active',
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

export default router;
