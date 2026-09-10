import type { Request, Response } from 'express';
import { Router } from 'express';

import {
  getCommissionSummary,
  listCommissionOrders,
  releaseCommissionOrders,
  unreleaseCommissionOrders,
} from '../data/commissionStore.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { queryString } from './pagination.js';

const router = Router();

router.use(requireAuth, requirePermission('manage_commissions'));

// Same cap as finance.ts's /summary -- bounds the range_bounds scan over orders.
const MAX_RANGE_DAYS = 366;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ORDER_IDS = 500;

function parseDateOnly(value: string): string | null {
  return DATE_ONLY_REGEX.test(value) ? value : null;
}

/** Shared by /summary and /orders: validates dateFrom/dateTo and forces staff callers to their
 * own layout_by, regardless of what's passed in the query. */
function resolveDateRange(req: Request, res: Response): { dateFrom: string; dateTo: string; layoutBy?: string } | null {
  const dateFrom = parseDateOnly(queryString(req.query.dateFrom));
  const dateTo = parseDateOnly(queryString(req.query.dateTo));
  if (!dateFrom || !dateTo) {
    res.status(400).json({ error: '"dateFrom" and "dateTo" are required and must be YYYY-MM-DD' });
    return null;
  }
  if (dateFrom > dateTo) {
    res.status(400).json({ error: '"dateFrom" must not be after "dateTo"' });
    return null;
  }
  const spanDays = (Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000 + 1;
  if (spanDays > MAX_RANGE_DAYS) {
    res.status(400).json({ error: `Date range cannot exceed ${MAX_RANGE_DAYS} days` });
    return null;
  }

  const layoutBy = req.user!.role === 'staff' ? req.user!.sub : queryString(req.query.layoutBy) || undefined;
  return { dateFrom, dateTo, layoutBy };
}

function parseOrderIds(body: unknown): string[] | null {
  if (!Array.isArray(body) || body.length === 0 || body.length > MAX_ORDER_IDS) return null;
  if (!body.every((id) => typeof id === 'string' && id.trim())) return null;
  return body as string[];
}

router.get('/summary', async (req, res, next) => {
  try {
    const range = resolveDateRange(req, res);
    if (!range) return;
    const rows = await getCommissionSummary(range.dateFrom, range.dateTo, range.layoutBy);
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

router.get('/orders', async (req, res, next) => {
  try {
    const range = resolveDateRange(req, res);
    if (!range) return;
    const rows = await listCommissionOrders(range.dateFrom, range.dateTo, range.layoutBy);
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

router.post('/release', requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const orderIds = parseOrderIds(req.body?.orderIds);
    if (!orderIds) {
      res.status(400).json({ error: `"orderIds" must be a non-empty array of strings (max ${MAX_ORDER_IDS})` });
      return;
    }
    const releasedIds = await releaseCommissionOrders(orderIds, req.user!.sub);
    res.json({ releasedIds });
  } catch (err) {
    next(err);
  }
});

router.post('/unrelease', requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const orderIds = parseOrderIds(req.body?.orderIds);
    if (!orderIds) {
      res.status(400).json({ error: `"orderIds" must be a non-empty array of strings (max ${MAX_ORDER_IDS})` });
      return;
    }
    const unreleasedIds = await unreleaseCommissionOrders(orderIds);
    res.json({ unreleasedIds });
  } catch (err) {
    next(err);
  }
});

export default router;
