import { Router } from 'express';

import {
  createCategory,
  deleteCategory,
  DuplicateCategoryNameError,
  getCategory,
  listCategories,
  listHotSizes,
  updateCategory,
} from '../data/categoryStore.js';
import { listOrderStatuses } from '../data/orderStatusStore.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

// Union of StickerUnit ("in"/"cm"/"mm") and LengthUnit ("mm"/"cm"/"in"/"ft"/"m") from the
// frontend — kept generic here since it's the Settings UI's <Select> options, not this
// route, that scope which subset is offered for a given category.
const COMMON_SIZE_UNITS = ['mm', 'cm', 'in', 'ft', 'm'];
const MAX_COMMON_SIZES = 8;

const router = Router();

router.use(requireAuth);

// Order statuses considered "terminal" are excluded from a category's configured flow —
// those stay universal (appended by the frontend's getOrderStatusOptions regardless of
// category), same 3 names as ORDER_TERMINAL_STATUSES in the frontend's order-status.ts.
const TERMINAL_STATUS_NAMES = ['cancelled', 'refunded', 'returned'];

function validateName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) {
    return '"name" is required';
  }
  if (name.trim().length > 60) {
    return '"name" must be at most 60 characters';
  }
  return null;
}

/** Non-terminal, enabled order-status names a category's workflow can be built from —
 * fetched live from the admin-managed order_statuses table rather than a fixed array,
 * since statuses can now be added/renamed/disabled at any time. */
async function validateStatusFlow(statusFlow: unknown): Promise<string | null> {
  if (!Array.isArray(statusFlow) || statusFlow.length === 0) {
    return '"statusFlow" must be a non-empty array';
  }
  const allowedNames = (await listOrderStatuses())
    .filter((status) => status.enabled && !TERMINAL_STATUS_NAMES.includes(status.name))
    .map((status) => status.name);
  if (!statusFlow.every((status) => typeof status === 'string' && allowedNames.includes(status))) {
    return `"statusFlow" may only contain: ${allowedNames.join(', ')}`;
  }
  if (new Set(statusFlow).size !== statusFlow.length) {
    return '"statusFlow" cannot contain duplicate statuses';
  }
  if (!statusFlow.includes('pending') || !statusFlow.includes('released')) {
    return '"statusFlow" must include both "pending" and "released"';
  }
  return null;
}

function validateCommonSizes(commonSizes: unknown): string | null {
  if (!Array.isArray(commonSizes)) {
    return '"commonSizes" must be an array';
  }
  if (commonSizes.length > MAX_COMMON_SIZES) {
    return `"commonSizes" may contain at most ${MAX_COMMON_SIZES} entries`;
  }
  for (const size of commonSizes) {
    if (typeof size !== 'object' || size === null) {
      return '"commonSizes" entries must be objects';
    }
    const { width, height, unit } = size as Record<string, unknown>;
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
      return '"commonSizes" entries must have a positive numeric "width"';
    }
    if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
      return '"commonSizes" entries must have a positive numeric "height"';
    }
    if (typeof unit !== 'string' || !COMMON_SIZE_UNITS.includes(unit)) {
      return `"commonSizes" entries' "unit" must be one of: ${COMMON_SIZE_UNITS.join(', ')}`;
    }
  }
  return null;
}

router.get('/', async (_req, res, next) => {
  try {
    const categories = await listCategories();
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

// Registered before '/:id' so "hot-sizes" isn't matched as a category id.
router.get('/hot-sizes', async (_req, res, next) => {
  try {
    const hotSizes = await listHotSizes();
    res.json(hotSizes);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const category = await getCategory(req.params.id);
    if (!category) {
      res.status(404).json({ error: `Category not found: ${req.params.id}` });
      return;
    }
    res.json(category);
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
    const statusFlowError = await validateStatusFlow(req.body?.statusFlow ?? ['pending', 'released']);
    if (statusFlowError) {
      res.status(400).json({ error: statusFlowError });
      return;
    }
    const commonSizesError = validateCommonSizes(req.body?.commonSizes ?? []);
    if (commonSizesError) {
      res.status(400).json({ error: commonSizesError });
      return;
    }
    const category = await createCategory(req.body ?? {});
    res.status(201).json(category);
  } catch (err) {
    if (err instanceof DuplicateCategoryNameError) {
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
    if (req.body?.statusFlow !== undefined) {
      const statusFlowError = await validateStatusFlow(req.body.statusFlow);
      if (statusFlowError) {
        res.status(400).json({ error: statusFlowError });
        return;
      }
    }
    if (req.body?.commonSizes !== undefined) {
      const commonSizesError = validateCommonSizes(req.body.commonSizes);
      if (commonSizesError) {
        res.status(400).json({ error: commonSizesError });
        return;
      }
    }
    const updated = await updateCategory(req.params.id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: `Category not found: ${req.params.id}` });
      return;
    }
    res.json(updated);
  } catch (err) {
    if (err instanceof DuplicateCategoryNameError) {
      res.status(409).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.delete('/:id', requirePermission('manage_products'), async (req, res, next) => {
  try {
    const result = await deleteCategory(req.params.id);
    if (!result.deleted) {
      if (result.inUseCount) {
        res.status(409).json({
          error: `Cannot delete "${result.name}"; it is used by ${result.inUseCount} product(s). Deactivate it instead.`,
        });
        return;
      }
      res.status(404).json({ error: `Category not found: ${req.params.id}` });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
