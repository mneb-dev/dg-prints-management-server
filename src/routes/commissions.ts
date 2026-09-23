import type { Request, Response } from 'express';
import { Router } from 'express';

import {
  getCommissionSummary,
  getMonthlyIncentiveHistory,
  getMonthlyIncentiveSummary,
  listCommissionOrders,
  releaseCommissionOrders,
  releaseMonthlyIncentive,
  unreleaseCommissionOrders,
  unreleaseMonthlyIncentive,
} from '../data/commissionStore.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { parsePage, parsePageSize, parseSortBy, queryString } from './pagination.js';

const router = Router();

router.use(requireAuth, requirePermission('manage_incentives'));

// Same cap as finance.ts's /summary -- bounds the range_bounds scan over orders.
const MAX_RANGE_DAYS = 366;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ORDER_IDS = 500;

function parseDateOnly(value: string): string | null {
  return DATE_ONLY_REGEX.test(value) ? value : null;
}

/** Shared by /summary, /orders, and /monthly-incentive-summary: validates dateFrom/dateTo. */
function parseAndValidateDateRange(req: Request, res: Response): { dateFrom: string; dateTo: string } | null {
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
  return { dateFrom, dateTo };
}

/** Shared by /summary and /orders: validates dateFrom/dateTo and forces staff callers to their
 * own layout_by, regardless of what's passed in the query. */
function resolveDateRange(req: Request, res: Response): { dateFrom: string; dateTo: string; layoutBy?: string } | null {
  const range = parseAndValidateDateRange(req, res);
  if (!range) return null;
  const layoutBy = req.user!.role === 'staff' ? req.user!.sub : queryString(req.query.layoutBy) || undefined;
  return { ...range, layoutBy };
}

function parseOrderIds(body: unknown): string[] | null {
  if (!Array.isArray(body) || body.length === 0 || body.length > MAX_ORDER_IDS) return null;
  if (!body.every((id) => typeof id === 'string' && id.trim())) return null;
  return body as string[];
}

/** Shared by the monthly incentive release/unrelease routes: validates a body-supplied date range
 * (as opposed to parseAndValidateDateRange's query-supplied one). */
function parseAndValidateBodyDateRange(req: Request, res: Response): { dateFrom: string; dateTo: string } | null {
  const dateFrom = parseDateOnly(typeof req.body?.dateFrom === 'string' ? req.body.dateFrom : '');
  const dateTo = parseDateOnly(typeof req.body?.dateTo === 'string' ? req.body.dateTo : '');
  if (!dateFrom || !dateTo) {
    res.status(400).json({ error: '"dateFrom" and "dateTo" are required and must be YYYY-MM-DD' });
    return null;
  }
  return { dateFrom, dateTo };
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

const RELEASE_FILTERS = ['all', 'released', 'unreleased'] as const;

// Paged in Node rather than in the RPC: the range is capped at MAX_RANGE_DAYS, so the full set is
// bounded, and it lets pendingReleaseIds cover every page for the portal's "Release all pending".
router.get('/orders', async (req, res, next) => {
  try {
    const range = resolveDateRange(req, res);
    if (!range) return;
    const parsedPageSize = parsePageSize(req.query.pageSize);
    if (typeof parsedPageSize !== 'number') {
      res.status(400).json({ error: parsedPageSize.error });
      return;
    }
    const page = parsePage(req.query.page);
    const release = parseSortBy(req.query.release, RELEASE_FILTERS, 'all');

    const allRows = await listCommissionOrders(range.dateFrom, range.dateTo, range.layoutBy);
    // Same rule as the portal's getCommissionReleaseStatus: only paid orders can be released.
    const isReleased = (row: (typeof allRows)[number]) => row.paymentStatus === 'paid' && row.releasedAt !== null;
    const filtered =
      release === 'all' ? allRows : allRows.filter((row) => (release === 'released') === isReleased(row));
    const pendingReleaseIds = allRows
      .filter((row) => row.paymentStatus === 'paid' && row.releasedAt === null)
      .map((row) => row.id);

    const from = (page - 1) * parsedPageSize;
    res.json({
      rows: filtered.slice(from, from + parsedPageSize),
      total: filtered.length,
      pendingReleaseIds,
    });
  } catch (err) {
    next(err);
  }
});

// Team-wide monthly tier pool -- no layoutBy scoping (the ladder/pool are inherently team-wide).
// Staff callers see the full tiers/pool/totalStaffSales (they need to track progress toward the
// team goal) but never the per-staff split, mirroring CommissionByStaffTable being hidden
// entirely in the staff view of the per-order commission feature.
router.get('/monthly-incentive-summary', async (req, res, next) => {
  try {
    const range = parseAndValidateDateRange(req, res);
    if (!range) return;
    const summary = await getMonthlyIncentiveSummary(range.dateFrom, range.dateTo, req.user!.sub);
    res.json(req.user!.role === 'staff' ? { ...summary, perStaff: [] } : summary);
  } catch (err) {
    next(err);
  }
});

// Admin/superadmin-only release history browser -- lets them page back through past months to
// release/undo, since the current month itself can never be released (see
// release_monthly_incentive's guard).
router.get('/monthly-incentive-summary/history', requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const year = Number(queryString(req.query.year));
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      res.status(400).json({ error: '"year" must be an integer between 2000 and 2100' });
      return;
    }
    const rows = await getMonthlyIncentiveHistory(year);
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

router.post('/monthly-incentive-summary/release', requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const range = parseAndValidateBodyDateRange(req, res);
    if (!range) return;
    const result = await releaseMonthlyIncentive(range.dateFrom, range.dateTo, req.user!.sub);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/monthly-incentive-summary/unrelease', requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const range = parseAndValidateBodyDateRange(req, res);
    if (!range) return;
    const result = await unreleaseMonthlyIncentive(range.dateFrom, range.dateTo);
    res.json(result);
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
