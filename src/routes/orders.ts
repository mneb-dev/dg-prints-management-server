import { Router } from 'express';

import {
  createOrder,
  deleteOrder,
  getOrder,
  listOrders,
  updateOrder,
} from '../data/orderStore.js';
import { getProduct } from '../data/productStore.js';
import { getUser } from '../data/userStore.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { parsePage, parsePageSize, parseSortBy, parseSortDir, queryString } from './pagination.js';

const router = Router();

router.use(requireAuth);

const ORDER_SORT_KEYS = ['order_number', 'customer_name', 'total', 'created_at'] as const;

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

function validateDescription(description: unknown): string | null {
  if (description === undefined || description === null) return null;
  if (typeof description !== 'string' || description.length > 20) {
    return '"description" must be a string of at most 20 characters';
  }
  return null;
}

function validateCustomerName(customerName: unknown, required: boolean): string | null {
  if (customerName === undefined || customerName === null) {
    return required ? '"customerName" is required' : null;
  }
  if (typeof customerName !== 'string' || !customerName.trim()) {
    return '"customerName" is required';
  }
  if (customerName.length > 60) {
    return '"customerName" must be at most 60 characters';
  }
  return null;
}

function validateShippingAddress(shippingAddress: unknown): string | null {
  if (shippingAddress === undefined || shippingAddress === null) return null;
  if (typeof shippingAddress !== 'object') {
    return '"shippingAddress" must be an object';
  }
  const { name, address } = shippingAddress as { name?: unknown; address?: unknown };
  if (name !== undefined && (typeof name !== 'string' || name.length > 60)) {
    return '"shippingAddress.name" must be a string of at most 60 characters';
  }
  if (address !== undefined && (typeof address !== 'string' || address.length > 250)) {
    return '"shippingAddress.address" must be a string of at most 250 characters';
  }
  return null;
}

function validateItemNotes(items: unknown): string | null {
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const notes = (item as { notes?: unknown } | null)?.notes;
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 60)) {
      return '"notes" must be a string of at most 60 characters';
    }
  }
  return null;
}

const ADMIN_METADATA_KEYS = ['createdAt', 'createdBy', 'statusUpdatedAt', 'statusUpdatedBy'] as const;

// createdAt/createdBy/statusUpdatedAt/statusUpdatedBy are normally derived server-side
// (see orderStore.ts#updateOrder); only admin/superadmin may override them directly.
async function validateAdminMetadata(
  body: Record<string, unknown>,
  role: string | undefined
): Promise<{ status: number; error: string } | null> {
  const present = ADMIN_METADATA_KEYS.filter((key) => body[key] !== undefined);
  if (present.length === 0) return null;
  if (role !== 'admin' && role !== 'superadmin') {
    return { status: 403, error: 'Only admin or superadmin can modify created/status metadata' };
  }
  for (const key of ['createdAt', 'statusUpdatedAt'] as const) {
    const value = body[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      return { status: 400, error: `"${key}" must be a valid date` };
    }
    if (Date.parse(value) > Date.now()) {
      return { status: 400, error: `"${key}" cannot be in the future` };
    }
  }
  for (const key of ['createdBy', 'statusUpdatedBy'] as const) {
    const value = body[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      return { status: 400, error: `"${key}" must be a user id` };
    }
    const user = await getUser(value);
    if (!user) {
      return { status: 400, error: `User not found: ${value}` };
    }
  }
  return null;
}

router.get('/', async (req, res, next) => {
  try {
    const pageSize = parsePageSize(req.query.pageSize);
    if (typeof pageSize !== 'number') {
      res.status(400).json({ error: pageSize.error });
      return;
    }
    const page = parsePage(req.query.page);
    const dateFromRaw = queryString(req.query.dateFrom);
    const dateToRaw = queryString(req.query.dateTo);

    if (
      (dateFromRaw && Number.isNaN(Date.parse(dateFromRaw))) ||
      (dateToRaw && Number.isNaN(Date.parse(dateToRaw)))
    ) {
      res.status(400).json({ error: '"dateFrom"/"dateTo" must be valid dates (YYYY-MM-DD)' });
      return;
    }

    const result = await listOrders({
      page,
      pageSize,
      search: queryString(req.query.search),
      category: queryString(req.query.category),
      status: queryString(req.query.status),
      paymentStatus: queryString(req.query.paymentStatus),
      dateFrom: dateFromRaw ? new Date(dateFromRaw).toISOString() : undefined,
      dateTo: dateToRaw ? new Date(`${dateToRaw}T23:59:59.999`).toISOString() : undefined,
      sortBy: parseSortBy(req.query.sortBy, ORDER_SORT_KEYS, 'created_at'),
      sortDir: parseSortDir(req.query.sortDir),
    });
    res.json(result);
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

router.post('/', requirePermission('manage_orders'), async (req, res, next) => {
  try {
    const customerNameError = validateCustomerName(req.body?.customerName, true);
    if (customerNameError) {
      res.status(400).json({ error: customerNameError });
      return;
    }
    const productError = await validateActiveProducts(req.body?.items);
    if (productError) {
      res.status(400).json({ error: productError });
      return;
    }
    const descriptionError = validateDescription(req.body?.description);
    if (descriptionError) {
      res.status(400).json({ error: descriptionError });
      return;
    }
    const shippingAddressError = validateShippingAddress(req.body?.shippingAddress);
    if (shippingAddressError) {
      res.status(400).json({ error: shippingAddressError });
      return;
    }
    const itemNotesError = validateItemNotes(req.body?.items);
    if (itemNotesError) {
      res.status(400).json({ error: itemNotesError });
      return;
    }
    const order = await createOrder(req.body, req.user!.sub);
    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('manage_orders'), async (req, res, next) => {
  try {
    const metadataError = await validateAdminMetadata(
      (req.body ?? {}) as Record<string, unknown>,
      req.user?.role
    );
    if (metadataError) {
      res.status(metadataError.status).json({ error: metadataError.error });
      return;
    }
    const customerNameError = validateCustomerName(req.body?.customerName, false);
    if (customerNameError) {
      res.status(400).json({ error: customerNameError });
      return;
    }
    const productError = await validateActiveProducts(req.body?.items);
    if (productError) {
      res.status(400).json({ error: productError });
      return;
    }
    const descriptionError = validateDescription(req.body?.description);
    if (descriptionError) {
      res.status(400).json({ error: descriptionError });
      return;
    }
    const shippingAddressError = validateShippingAddress(req.body?.shippingAddress);
    if (shippingAddressError) {
      res.status(400).json({ error: shippingAddressError });
      return;
    }
    const itemNotesError = validateItemNotes(req.body?.items);
    if (itemNotesError) {
      res.status(400).json({ error: itemNotesError });
      return;
    }
    const updated = await updateOrder(req.params.id, req.body ?? {}, req.user!.sub);
    if (!updated) {
      res.status(404).json({ error: `Order not found: ${req.params.id}` });
      return;
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission('manage_orders'), async (req, res, next) => {
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
