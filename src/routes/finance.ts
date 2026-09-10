import { Router } from 'express';

import { getFinanceSummary } from '../data/financeStore.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { queryString } from './pagination.js';

const router = Router();

router.use(requireAuth, requireRole('admin', 'superadmin'));

// Caps generate_series() row count / response size for the trend chart.
const MAX_RANGE_DAYS = 366;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value: string): string | null {
  return DATE_ONLY_REGEX.test(value) ? value : null;
}

router.get('/summary', async (req, res, next) => {
  try {
    const dateFrom = parseDateOnly(queryString(req.query.dateFrom));
    const dateTo = parseDateOnly(queryString(req.query.dateTo));
    if (!dateFrom || !dateTo) {
      res.status(400).json({ error: '"dateFrom" and "dateTo" are required and must be YYYY-MM-DD' });
      return;
    }
    if (dateFrom > dateTo) {
      res.status(400).json({ error: '"dateFrom" must not be after "dateTo"' });
      return;
    }
    const spanDays = (Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000 + 1;
    if (spanDays > MAX_RANGE_DAYS) {
      res.status(400).json({ error: `Date range cannot exceed ${MAX_RANGE_DAYS} days` });
      return;
    }
    const summary = await getFinanceSummary(dateFrom, dateTo);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

export default router;
