import { Router } from 'express';

import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from '../data/productStore.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { parsePage, parsePageSize, parseSortBy, parseSortDir, queryString } from './pagination.js';

const router = Router();

router.use(requireAuth);

const PRODUCT_SORT_KEYS = ['name', 'category', 'status', 'created_at'] as const;

function validateDescription(description: unknown): string | null {
  if (description === undefined || description === null) return null;
  if (typeof description !== 'string' || description.length > 60) {
    return '"description" must be a string of at most 60 characters';
  }
  return null;
}

function validatePricing(pricing: unknown): string | null {
  if (!Array.isArray(pricing) || pricing.length === 0) {
    return '"pricing" must be a non-empty array';
  }
  const hasInvalidEntry = pricing.some((entry) => {
    const price = (entry as { price?: unknown } | null)?.price;
    return typeof price !== 'number' || !Number.isFinite(price) || price <= 0;
  });
  if (hasInvalidEntry) {
    return 'each pricing entry must have a "price" greater than 0';
  }
  return null;
}

router.get('/', async (req, res, next) => {
  try {
    const all = req.query.all === 'true';
    let pageSize: number | null;
    if (all) {
      pageSize = null;
    } else {
      const parsed = parsePageSize(req.query.pageSize);
      if (typeof parsed !== 'number') {
        res.status(400).json({ error: parsed.error });
        return;
      }
      pageSize = parsed;
    }
    const page = all ? 1 : parsePage(req.query.page);

    const result = await listProducts({
      page,
      pageSize,
      search: queryString(req.query.search),
      category: queryString(req.query.category),
      status: queryString(req.query.status),
      pricingType: queryString(req.query.pricingType),
      sortBy: parseSortBy(req.query.sortBy, PRODUCT_SORT_KEYS, 'created_at'),
      sortDir: parseSortDir(req.query.sortDir),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const product = await getProduct(req.params.id);
    if (!product) {
      res.status(404).json({ error: `Product not found: ${req.params.id}` });
      return;
    }
    res.json(product);
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('manage_products'), async (req, res, next) => {
  try {
    const { name } = req.body ?? {};
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: '"name" is required' });
      return;
    }
    const descriptionError = validateDescription(req.body?.description);
    if (descriptionError) {
      res.status(400).json({ error: descriptionError });
      return;
    }
    const pricingError = validatePricing(req.body?.pricing);
    if (pricingError) {
      res.status(400).json({ error: pricingError });
      return;
    }
    const product = await createProduct(req.body);
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('manage_products'), async (req, res, next) => {
  try {
    const descriptionError = validateDescription(req.body?.description);
    if (descriptionError) {
      res.status(400).json({ error: descriptionError });
      return;
    }
    if (req.body?.pricing !== undefined) {
      const pricingError = validatePricing(req.body.pricing);
      if (pricingError) {
        res.status(400).json({ error: pricingError });
        return;
      }
    }
    const updated = await updateProduct(req.params.id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: `Product not found: ${req.params.id}` });
      return;
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission('manage_products'), async (req, res, next) => {
  try {
    const deleted = await deleteProduct(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: `Product not found: ${req.params.id}` });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
