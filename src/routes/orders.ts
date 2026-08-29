import { Router } from 'express';

import {
  createOrder,
  deleteOrder,
  getOrder,
  listOrders,
  updateOrder,
} from '../data/orderStore.js';
import { getProduct } from '../data/productStore.js';

const router = Router();

async function validateActiveProducts(items: unknown): Promise<string | null> {
  if (!Array.isArray(items) || items.length === 0) return null;
  const ids = [
    ...new Set(
      items
        .map((item) => (item as { productId?: unknown } | null)?.productId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ),
  ];
  if (ids.length === 0) return null;
  const products = await Promise.all(ids.map((id) => getProduct(id)));
  const missingIndex = products.findIndex((product) => !product);
  if (missingIndex !== -1) {
    return `Product not found: ${ids[missingIndex]}`;
  }
  const inactive = products.find((product) => product && product.status !== 'Active');
  if (inactive) {
    return `Cannot save order: product "${inactive.name}" is inactive.`;
  }
  return null;
}

router.get('/', async (_req, res, next) => {
  try {
    res.json(await listOrders());
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const order = await getOrder(req.params.id);
    if (!order) {
      res.status(404).json({ error: `Order not found: ${req.params.id}` });
      return;
    }
    res.json(order);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { customerName } = req.body ?? {};
    if (!customerName || typeof customerName !== 'string') {
      res.status(400).json({ error: '"customerName" is required' });
      return;
    }
    const productError = await validateActiveProducts(req.body?.items);
    if (productError) {
      res.status(400).json({ error: productError });
      return;
    }
    const order = await createOrder(req.body);
    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const productError = await validateActiveProducts(req.body?.items);
    if (productError) {
      res.status(400).json({ error: productError });
      return;
    }
    const updated = await updateOrder(req.params.id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: `Order not found: ${req.params.id}` });
      return;
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await deleteOrder(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: `Order not found: ${req.params.id}` });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
