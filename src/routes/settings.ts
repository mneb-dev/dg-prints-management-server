import { Router } from 'express';

import { getSettings, updateSettings } from '../data/settingsStore.js';
import { requireAuth, requireSuperadminOrPermission } from '../middleware/auth.js';
import type { AppSettingsInput } from '../types/settings.js';
import { MESSENGER_LINK_HOSTS, toMessengerUrl } from '../utils/messengerUrl.js';
import { SUPPORTED_SHOP_PAYMENT_METHODS } from '../utils/paymongo.js';

const router = Router();

router.use(requireAuth);

function validateShippingFee(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '"shippingFee" must be a non-negative number';
  }
  return null;
}

function validateMessengerUrl(value: unknown): string | null {
  const message = '"messengerUrl" must be empty or an https link to m.me, facebook.com or messenger.com';
  if (typeof value !== 'string' || value.length > 200) return message;
  if (value === '') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && MESSENGER_LINK_HOSTS.includes(url.hostname) ? null : message;
  } catch {
    return message;
  }
}

export const MAX_CONVENIENCE_FEE_PERCENT = 20;

function validateConvenienceFeePercent(value: unknown): string | null {
  const valid =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_CONVENIENCE_FEE_PERCENT &&
    Math.round(value * 100) === value * 100;
  return valid ? null : `"convenienceFeePercent" must be a number from 0 to ${MAX_CONVENIENCE_FEE_PERCENT} with at most 2 decimals`;
}

function validateShopPaymentMethods(value: unknown): string | null {
  const supported = SUPPORTED_SHOP_PAYMENT_METHODS as readonly string[];
  const valid =
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((type) => typeof type === 'string' && supported.includes(type)) &&
    new Set(value).size === value.length;
  return valid ? null : `"shopPaymentMethods" must list at least one of: ${supported.join(', ')} (no repeats)`;
}

router.get('/', async (_req, res, next) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// Partial update: only the fields present in the body are validated and written.
router.put('/', requireSuperadminOrPermission('manage_settings'), async (req, res, next) => {
  try {
    const input: AppSettingsInput = {};
    if (req.body?.shippingFee !== undefined) {
      const error = validateShippingFee(req.body.shippingFee);
      if (error) {
        res.status(400).json({ error });
        return;
      }
      input.shippingFee = req.body.shippingFee;
    }
    if (req.body?.shippingRates !== undefined) {
      const rates = req.body.shippingRates as Record<string, unknown> | null;
      const valid =
        !!rates &&
        typeof rates === 'object' &&
        (['luzon', 'visayas', 'mindanao'] as const).every(
          (region) => typeof rates[region] === 'number' && Number.isFinite(rates[region]) && (rates[region] as number) >= 0
        );
      if (!valid) {
        res.status(400).json({ error: '"shippingRates" must have non-negative "luzon", "visayas" and "mindanao" fees' });
        return;
      }
      input.shippingRates = {
        luzon: rates!.luzon as number,
        visayas: rates!.visayas as number,
        mindanao: rates!.mindanao as number,
      };
    }
    if (req.body?.messengerUrl !== undefined) {
      const messengerUrl = typeof req.body.messengerUrl === 'string' ? req.body.messengerUrl.trim() : req.body.messengerUrl;
      const error = validateMessengerUrl(messengerUrl);
      if (error) {
        res.status(400).json({ error });
        return;
      }
      // Store Page links as m.me links so the shop's button opens a chat.
      input.messengerUrl = toMessengerUrl(messengerUrl);
    }
    if (req.body?.convenienceFeePercent !== undefined) {
      const error = validateConvenienceFeePercent(req.body.convenienceFeePercent);
      if (error) {
        res.status(400).json({ error });
        return;
      }
      input.convenienceFeePercent = req.body.convenienceFeePercent;
    }
    if (req.body?.shopPaymentMethods !== undefined) {
      const error = validateShopPaymentMethods(req.body.shopPaymentMethods);
      if (error) {
        res.status(400).json({ error });
        return;
      }
      input.shopPaymentMethods = req.body.shopPaymentMethods;
    }
    if (Object.keys(input).length === 0) {
      res
        .status(400)
        .json({
          error: 'Provide "shippingFee", "shippingRates", "messengerUrl", "convenienceFeePercent" and/or "shopPaymentMethods"',
        });
      return;
    }

    const updated = await updateSettings(input);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
