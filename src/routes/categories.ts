import { Router } from 'express';

import {
  createCategory,
  deleteCategory,
  DuplicateCategoryNameError,
  getCategory,
  listCategories,
  updateCategory,
} from '../data/categoryStore.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// Non-terminal order statuses a category's workflow can be built from — same set and
// order as CATEGORY_STATUS_FLOW_OPTIONS in the frontend's order-status.ts. `cancelled`/
// `refunded` are excluded: those stay universal, not part of a category's configured flow.
const CATEGORY_STATUS_OPTIONS = [
  'pending',
  'layout',
  'trace',
  'print',
  'cut',
  'pack',
  'pickup',
  'released',
];

function validateName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) {
    return '"name" is required';
  }
  if (name.trim().length > 60) {
    return '"name" must be at most 60 characters';
  }
  return null;
}

function validateStatusFlow(statusFlow: unknown): string | null {
  if (!Array.isArray(statusFlow) || statusFlow.length === 0) {
    return '"statusFlow" must be a non-empty array';
  }
  if (!statusFlow.every((status) => typeof status === 'string' && CATEGORY_STATUS_OPTIONS.includes(status))) {
    return `"statusFlow" may only contain: ${CATEGORY_STATUS_OPTIONS.join(', ')}`;
  }
  if (new Set(statusFlow).size !== statusFlow.length) {
    return '"statusFlow" cannot contain duplicate statuses';
  }
  if (!statusFlow.includes('pending') || !statusFlow.includes('released')) {
    return '"statusFlow" must include both "pending" and "released"';
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
    const statusFlowError = validateStatusFlow(req.body?.statusFlow ?? ['pending', 'released']);
    if (statusFlowError) {
      res.status(400).json({ error: statusFlowError });
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
      const statusFlowError = validateStatusFlow(req.body.statusFlow);
      if (statusFlowError) {
        res.status(400).json({ error: statusFlowError });
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
