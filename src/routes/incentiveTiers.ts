import { Router } from 'express';

import {
  countIncentiveTiers,
  createIncentiveTier,
  deleteIncentiveTier,
  DuplicateIncentiveTierError,
  listIncentiveTiers,
  updateIncentiveTier,
} from '../data/incentiveTierStore.js';
import { requireAuth, requireSuperadminOrPermission } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

function validatePositiveNumber(value: unknown, field: string): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return `"${field}" must be a positive number`;
  }
  return null;
}

router.get('/', async (_req, res, next) => {
  try {
    res.json(await listIncentiveTiers());
  } catch (err) {
    next(err);
  }
});

router.post('/', requireSuperadminOrPermission('manage_settings'), async (req, res, next) => {
  try {
    const thresholdError = validatePositiveNumber(req.body?.threshold, 'threshold');
    if (thresholdError) {
      res.status(400).json({ error: thresholdError });
      return;
    }
    const amountError = validatePositiveNumber(req.body?.amount, 'amount');
    if (amountError) {
      res.status(400).json({ error: amountError });
      return;
    }
    const tier = await createIncentiveTier({ threshold: req.body.threshold, amount: req.body.amount });
    res.status(201).json(tier);
  } catch (err) {
    if (err instanceof DuplicateIncentiveTierError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.put('/:id', requireSuperadminOrPermission('manage_settings'), async (req, res, next) => {
  try {
    if (req.body?.threshold !== undefined) {
      const thresholdError = validatePositiveNumber(req.body.threshold, 'threshold');
      if (thresholdError) {
        res.status(400).json({ error: thresholdError });
        return;
      }
    }
    if (req.body?.amount !== undefined) {
      const amountError = validatePositiveNumber(req.body.amount, 'amount');
      if (amountError) {
        res.status(400).json({ error: amountError });
        return;
      }
    }
    const updated = await updateIncentiveTier(req.params.id, {
      threshold: req.body?.threshold,
      amount: req.body?.amount,
    });
    if (!updated) {
      res.status(404).json({ error: `Incentive tier not found: ${req.params.id}` });
      return;
    }
    res.json(updated);
  } catch (err) {
    if (err instanceof DuplicateIncentiveTierError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.delete('/:id', requireSuperadminOrPermission('manage_settings'), async (req, res, next) => {
  try {
    // The pool lookup needs at least one tier to mean anything -- refuse to delete the last one
    // rather than letting the incentive silently go permanently unearnable.
    const remaining = await countIncentiveTiers();
    if (remaining <= 1) {
      res.status(400).json({ error: 'At least one incentive tier is required.' });
      return;
    }
    const deleted = await deleteIncentiveTier(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: `Incentive tier not found: ${req.params.id}` });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
