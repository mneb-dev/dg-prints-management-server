import { Router } from 'express';

import { getSettings, updateSettings } from '../data/settingsStore.js';
import { requireAuth, requireSuperadminOrPermission } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

function validateShippingFee(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '"shippingFee" must be a non-negative number';
  }
  return null;
}

router.get('/', async (_req, res, next) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

router.put('/', requireSuperadminOrPermission('manage_settings'), async (req, res, next) => {
  try {
    const shippingFeeError = validateShippingFee(req.body?.shippingFee);
    if (shippingFeeError) {
      res.status(400).json({ error: shippingFeeError });
      return;
    }

    const updated = await updateSettings({ shippingFee: req.body.shippingFee });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
