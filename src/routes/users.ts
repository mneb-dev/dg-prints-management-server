import { Router } from 'express';

import {
  createUser,
  deleteUser,
  findSuperadminId,
  getUser,
  listUsers,
  updateUser,
} from '../data/userStore.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import type { UserInput } from '../types/user.js';
import { parsePage, parsePageSize, parseSortBy, parseSortDir, queryString } from './pagination.js';

const router = Router();

router.use(requireAuth, requireRole('admin', 'superadmin'), requirePermission('manage_users'));

const USER_SORT_KEYS = ['name', 'username', 'role', 'created_at'] as const;

const SUPERADMIN_CONFLICT_ERROR = 'Only one super admin is allowed. Demote the current super admin first.';

router.get('/', async (req, res, next) => {
  try {
    const all = req.query.all === 'true';
    let pageSize: number | null;
    if (all) {
      pageSize = null;
    } else {
      const parsed = parsePageSize(req.query.pageSize);
      if (typeof parsed !== 'number') {
        res.status(400).json({ error: parsed.error });
        return;
      }
      pageSize = parsed;
    }
    const page = all ? 1 : parsePage(req.query.page);

    const result = await listUsers({
      page,
      pageSize,
      search: queryString(req.query.search),
      role: queryString(req.query.role),
      status: queryString(req.query.status),
      sortBy: parseSortBy(req.query.sortBy, USER_SORT_KEYS, 'created_at'),
      sortDir: parseSortDir(req.query.sortDir),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const user = await getUser(req.params.id);
    if (!user) {
      res.status(404).json({ error: `User not found: ${req.params.id}` });
      return;
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const input = (req.body ?? {}) as UserInput;
    const { firstName, lastName, username, password } = input;
    if (!firstName || !lastName || !username || !password) {
      res
        .status(400)
        .json({ error: '"firstName", "lastName", "username", and "password" are required' });
      return;
    }

    if (input.role === 'superadmin' && (await findSuperadminId())) {
      res.status(409).json({ error: SUPERADMIN_CONFLICT_ERROR });
      return;
    }

    const user = await createUser(input);
    res.status(201).json(user);
  } catch (err) {
    if (err instanceof Error && err.message.includes('users_single_superadmin_key')) {
      res.status(409).json({ error: SUPERADMIN_CONFLICT_ERROR });
      return;
    }
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const existing = await getUser(req.params.id);
    if (!existing) {
      res.status(404).json({ error: `User not found: ${req.params.id}` });
      return;
    }
    if (req.user!.role === 'admin' && existing.role === 'superadmin') {
      res.status(403).json({ error: 'An admin cannot update a superadmin account.' });
      return;
    }

    const input = (req.body ?? {}) as UserInput;

    if (req.user!.sub === req.params.id && input.status === 'inactive') {
      res.status(403).json({ error: 'You cannot deactivate your own account.' });
      return;
    }

    if (input.role === 'superadmin' && (await findSuperadminId(req.params.id))) {
      res.status(409).json({ error: SUPERADMIN_CONFLICT_ERROR });
      return;
    }

    const updated = await updateUser(req.params.id, input);
    if (!updated) {
      res.status(404).json({ error: `User not found: ${req.params.id}` });
      return;
    }
    res.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message.includes('users_single_superadmin_key')) {
      res.status(409).json({ error: SUPERADMIN_CONFLICT_ERROR });
      return;
    }
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (req.user!.sub === req.params.id) {
      res.status(403).json({ error: 'You cannot delete your own account.' });
      return;
    }

    const existing = await getUser(req.params.id);
    if (!existing) {
      res.status(404).json({ error: `User not found: ${req.params.id}` });
      return;
    }
    if (req.user!.role === 'admin' && existing.role === 'superadmin') {
      res.status(403).json({ error: 'An admin cannot delete a superadmin account.' });
      return;
    }

    const deleted = await deleteUser(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: `User not found: ${req.params.id}` });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
