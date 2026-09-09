import { Router } from 'express';

import {
  createOrderStatus,
  deleteOrderStatus,
  DuplicateOrderStatusNameError,
  listOrderStatuses,
  ProtectedOrderStatusError,
  reorderOrderStatuses,
  updateOrderStatus,
} from '../data/orderStatusStore.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

// The literal stored on orders.status and inside categories.status_flow, and used as an
// orders-page query param — restrict to a slug-safe pattern rather than free text.
const NAME_PATTERN = /^[a-z0-9_-]+$/;

function validateName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) {
    return '"name" is required';
  }
  const trimmed = name.trim();
  if (trimmed.length > 60) {
    return '"name" must be at most 60 characters';
  }
  if (!NAME_PATTERN.test(trimmed)) {
    return '"name" may only contain lowercase letters, numbers, hyphens, and underscores';
  }
  return null;
}

function validateLabel(label: unknown): string | null {
  if (typeof label !== 'string' || !label.trim()) {
    return '"label" is required';
  }
  if (label.trim().length > 60) {
    return '"label" must be at most 60 characters';
  }
  return null;
}

function validateIcon(icon: unknown): string | null {
  if (icon === undefined) return null;
  if (typeof icon !== 'string' || !icon.trim()) {
    return '"icon" must be a non-empty string';
  }
  if (icon.trim().length > 40) {
    return '"icon" must be at most 40 characters';
  }
  return null;
}

function validateColor(color: unknown): string | null {
  if (color === undefined) return null;
  if (typeof color !== 'string' || !color.trim()) {
    return '"color" must be a non-empty string';
  }
  if (color.trim().length > 40) {
    return '"color" must be at most 40 characters';
  }
  return null;
}

const router = Router();

router.use(requireAuth);

router.get('/', async (_req, res, next) => {
  try {
    res.json(await listOrderStatuses());
  } catch (err) {
    next(err);
  }
});

// Registered before "/:id" so "reorder" isn't captured as an id.
router.put('/reorder', requirePermission('manage_products'), async (req, res, next) => {
  try {
    const order = req.body?.order;
    if (!Array.isArray(order) || !order.every((id) => typeof id === 'string')) {
      res.status(400).json({ error: '"order" must be an array of ids' });
      return;
    }
    res.json(await reorderOrderStatuses(order));
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('manage_products'), async (req, res, next) => {
  try {
    const nameError = validateName(req.body?.name);
    if (nameError) {
      res.status(400).json({ error: nameError });
      return;
    }
    const labelError = validateLabel(req.body?.label);
    if (labelError) {
      res.status(400).json({ error: labelError });
      return;
    }
    const iconError = validateIcon(req.body?.icon);
    if (iconError) {
      res.status(400).json({ error: iconError });
      return;
    }
    const colorError = validateColor(req.body?.color);
    if (colorError) {
      res.status(400).json({ error: colorError });
      return;
    }
    const status = await createOrderStatus({
      name: req.body.name,
      label: req.body.label,
      icon: req.body.icon,
      color: req.body.color,
    });
    res.status(201).json(status);
  } catch (err) {
    if (err instanceof DuplicateOrderStatusNameError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.put('/:id', requirePermission('manage_products'), async (req, res, next) => {
  try {
    if (req.body?.name !== undefined) {
      const nameError = validateName(req.body.name);
      if (nameError) {
        res.status(400).json({ error: nameError });
        return;
      }
    }
    if (req.body?.label !== undefined) {
      const labelError = validateLabel(req.body.label);
      if (labelError) {
        res.status(400).json({ error: labelError });
        return;
      }
    }
    if (req.body?.icon !== undefined) {
      const iconError = validateIcon(req.body.icon);
      if (iconError) {
        res.status(400).json({ error: iconError });
        return;
      }
    }
    if (req.body?.color !== undefined) {
      const colorError = validateColor(req.body.color);
      if (colorError) {
        res.status(400).json({ error: colorError });
        return;
      }
    }
    const updated = await updateOrderStatus(req.params.id, {
      name: req.body?.name,
      label: req.body?.label,
      icon: req.body?.icon,
      color: req.body?.color,
      enabled: req.body?.enabled,
    });
    if (!updated) {
      res.status(404).json({ error: `Order status not found: ${req.params.id}` });
      return;
    }
    res.json(updated);
  } catch (err) {
    if (err instanceof DuplicateOrderStatusNameError || err instanceof ProtectedOrderStatusError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.delete('/:id', requirePermission('manage_products'), async (req, res, next) => {
  try {
    const result = await deleteOrderStatus(req.params.id);
    if (!result.deleted) {
      if (result.protected) {
        res.status(409).json({ error: `Cannot delete "${result.name}"; it is a built-in status.` });
        return;
      }
      if (result.inUseCount) {
        res.status(409).json({
          error: `Cannot delete "${result.name}"; it is used by ${result.inUseCount} order(s). Disable it instead.`,
        });
        return;
      }
      res.status(404).json({ error: `Order status not found: ${req.params.id}` });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
