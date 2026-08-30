import { Router } from 'express';

import {
  createUser,
  deleteUser,
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

    const user = await createUser(input);
    res.status(201).json(user);
  } catch (err) {
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
    const input = (req.body ?? {}) as UserInput;
    const updated = await updateUser(req.params.id, input);
    if (!updated) {
      res.status(404).json({ error: `User not found: ${req.params.id}` });
      return;
    }
    res.json(updated);
  } catch (err) {
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
