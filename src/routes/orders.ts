import { Router } from 'express';

import {
  createOrder,
  deleteOrder,
  getOrder,
  getOrderStats,
  listOrders,
  listTopCustomers,
  updateOrder,
} from '../data/orderStore.js';
import { getProduct } from '../data/productStore.js';
import { getUser } from '../data/userStore.js';
import { CUSTOMER_RANKING_WINDOW_DAYS } from '../config/env.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { parseLimit, parsePage, parsePageSize, parseSortBy, parseSortDir, queryString } from './pagination.js';

const router = Router();

router.use(requireAuth);

const ORDER_SORT_KEYS = ['order_number', 'customer_name', 'total', 'created_at'] as const;
const MAX_RECENT_LIMIT = 200;

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

function validateOrderNotes(notes: unknown): string | null {
  if (notes === undefined || notes === null) return null;
  if (typeof notes !== 'string' || notes.length > 20) {
    return '"notes" must be a string of at most 20 characters';
  }
  return null;
}

function validateAdditionalFeesNotes(additionalFees: unknown, notes: unknown): string | null {
  if (additionalFees === undefined) return null;
  const fees = Number(additionalFees);
  if (Number.isFinite(fees) && fees > 0 && (typeof notes !== 'string' || !notes.trim())) {
    return '"notes" is required when "additionalFees" is greater than 0';
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

const PH_MOBILE_PHONE_REGEX = /^(?:\+63|63|0)9\d{9}$/;

function isValidPhMobileNumber(value: string): boolean {
  return PH_MOBILE_PHONE_REGEX.test(value.replace(/[\s-]/g, ''));
}

function validateCustomerPhone(customerPhone: unknown): string | null {
  if (customerPhone === undefined || customerPhone === null || customerPhone === '') return null;
  if (typeof customerPhone !== 'string' || !isValidPhMobileNumber(customerPhone)) {
    return '"customerPhone" must be a valid PH mobile number';
  }
  return null;
}

function validateShippingAddress(shippingAddress: unknown): string | null {
  if (shippingAddress === undefined || shippingAddress === null) return null;
  if (typeof shippingAddress !== 'object') {
    return '"shippingAddress" must be an object';
  }
  const { name, address, phone } = shippingAddress as { name?: unknown; address?: unknown; phone?: unknown };
  if (name !== undefined && (typeof name !== 'string' || name.length > 60)) {
    return '"shippingAddress.name" must be a string of at most 60 characters';
  }
  if (address !== undefined && (typeof address !== 'string' || address.length > 250)) {
    return '"shippingAddress.address" must be a string of at most 250 characters';
  }
  if (phone !== undefined && (typeof phone !== 'string' || !isValidPhMobileNumber(phone))) {
    return '"shippingAddress.phone" must be a valid PH mobile number';
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
    let pageSize: number;
    let page: number;
    if (req.query.limit !== undefined) {
      const limit = parseLimit(req.query.limit, MAX_RECENT_LIMIT);
      if (typeof limit !== 'number') {
        res.status(400).json({ error: limit.error });
        return;
      }
      pageSize = limit;
      page = 1;
    } else {
      const parsedPageSize = parsePageSize(req.query.pageSize);
      if (typeof parsedPageSize !== 'number') {
        res.status(400).json({ error: parsedPageSize.error });
        return;
      }
      pageSize = parsedPageSize;
      page = parsePage(req.query.page);
    }
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

// Registered before '/:id' so "customers" isn't matched as an order id.
router.get('/customers/top', async (req, res, next) => {
  try {
    const customers = await listTopCustomers(CUSTOMER_RANKING_WINDOW_DAYS);
    res.json({ customers, windowDays: CUSTOMER_RANKING_WINDOW_DAYS });
  } catch (err) {
    next(err);
  }
});

// Registered before '/:id' so "stats" isn't matched as an order id.
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await getOrderStats();
    res.json(stats);
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
    const customerPhoneError = validateCustomerPhone(req.body?.customerPhone);
    if (customerPhoneError) {
      res.status(400).json({ error: customerPhoneError });
      return;
    }
    const productError = await validateActiveProducts(req.body?.items);
    if (productError) {
      res.status(400).json({ error: productError });
      return;
    }
    const notesError = validateOrderNotes(req.body?.notes);
    if (notesError) {
      res.status(400).json({ error: notesError });
      return;
    }
    const additionalFeesNotesError = validateAdditionalFeesNotes(req.body?.additionalFees, req.body?.notes);
    if (additionalFeesNotesError) {
      res.status(400).json({ error: additionalFeesNotesError });
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
    const customerPhoneError = validateCustomerPhone(req.body?.customerPhone);
    if (customerPhoneError) {
      res.status(400).json({ error: customerPhoneError });
      return;
    }
    const productError = await validateActiveProducts(req.body?.items);
    if (productError) {
      res.status(400).json({ error: productError });
      return;
    }
    const notesError = validateOrderNotes(req.body?.notes);
    if (notesError) {
      res.status(400).json({ error: notesError });
      return;
    }
    const additionalFeesNotesError = validateAdditionalFeesNotes(req.body?.additionalFees, req.body?.notes);
    if (additionalFeesNotesError) {
      res.status(400).json({ error: additionalFeesNotesError });
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
