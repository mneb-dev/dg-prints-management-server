import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

import { CRON_SECRET } from '../config/env.js';
import { processRecurringExpenses } from '../data/recurringExpenseStore.js';

const router = Router();

// Not behind requireAuth (no user JWT): invoked by Vercel Cron, gated instead
// by a shared secret set via the CRON_SECRET env var / Vercel cron config.
function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!CRON_SECRET || header !== `Bearer ${CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// Vercel Cron always invokes via GET.
router.get('/process-recurring-expenses', requireCronSecret, async (_req, res, next) => {
  try {
    const generated = await processRecurringExpenses();
    res.json({ generated });
  } catch (err) {
    next(err);
  }
});

export default router;
