import { Router } from 'express';

import { createCatalogStore, DuplicateCatalogItemError } from '../data/catalogStore.js';
import { requireAuth, requireSuperadminOrPermission } from '../middleware/auth.js';

function validateName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) {
    return '"name" is required';
  }
  if (name.trim().length > 60) {
    return '"name" must be at most 60 characters';
  }
  return null;
}

/** Shared list/create/update/delete/reorder router for payment-methods and
 * order-channels — identical CRUD shape, mounted at two different paths. */
export function createCatalogRouter(
  store: ReturnType<typeof createCatalogStore>,
  resourceLabel: string
) {
  const router = Router();

  router.use(requireAuth);

  router.get('/', async (_req, res, next) => {
    try {
      res.json(await store.list());
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requireSuperadminOrPermission('manage_settings'), async (req, res, next) => {
    try {
      const nameError = validateName(req.body?.name);
      if (nameError) {
        res.status(400).json({ error: nameError });
        return;
      }
      const item = await store.create(req.body.name);
      res.status(201).json(item);
    } catch (err) {
      if (err instanceof DuplicateCatalogItemError) {
        res.status(409).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  // Registered before "/:id" so "reorder" isn't captured as an id.
  router.put('/reorder', requireSuperadminOrPermission('manage_settings'), async (req, res, next) => {
    try {
      const order = req.body?.order;
      if (!Array.isArray(order) || !order.every((id) => typeof id === 'string')) {
        res.status(400).json({ error: '"order" must be an array of ids' });
        return;
      }
      res.json(await store.reorder(order));
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', requireSuperadminOrPermission('manage_settings'), async (req, res, next) => {
    try {
      if (req.body?.name !== undefined) {
        const nameError = validateName(req.body.name);
        if (nameError) {
          res.status(400).json({ error: nameError });
          return;
        }
      }
      const updated = await store.update(req.params.id, {
        name: req.body?.name,
        enabled: req.body?.enabled,
      });
      if (!updated) {
        res.status(404).json({ error: `${resourceLabel} not found: ${req.params.id}` });
        return;
      }
      res.json(updated);
    } catch (err) {
      if (err instanceof DuplicateCatalogItemError) {
        res.status(409).json({ error: err.message });
        return;
      }
      next(err);
    }
  });

  router.delete('/:id', requireSuperadminOrPermission('manage_settings'), async (req, res, next) => {
    try {
      const deleted = await store.remove(req.params.id);
      if (!deleted) {
        res.status(404).json({ error: `${resourceLabel} not found: ${req.params.id}` });
        return;
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
