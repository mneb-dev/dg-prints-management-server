import bcrypt from 'bcryptjs';
import { Router } from 'express';
import jwt from 'jsonwebtoken';

import { JWT_EXPIRES_IN, JWT_SECRET } from '../config/env.js';
import {
  getUser,
  getUserByIdWithHash,
  getUserByUsernameWithHash,
  updateUser,
} from '../data/userStore.js';
import { requireAuth, type AuthPayload } from '../middleware/auth.js';

const router = Router();

function isStrongPassword(password: string): boolean {
  return (
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
      res.status(400).json({ error: '"username" and "password" are required' });
      return;
    }

    const row = await getUserByUsernameWithHash(username);
    const valid = row ? await bcrypt.compare(password, row.password_hash) : false;
    if (!row || !valid) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const payload: AuthPayload = {
      sub: row.id,
      username: row.username,
      role: row.role,
      permissions: row.permissions ?? [],
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);

    res.json({
      token,
      user: {
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        username: row.username,
        role: row.role,
        permissions: row.permissions ?? [],
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await getUser(req.user!.sub);
    if (!user) {
      res.status(401).json({ error: 'User no longer exists' });
      return;
    }
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const { firstName, lastName, username, avatar } = req.body ?? {};
    if (username !== undefined && username !== req.user!.username && req.user!.role === 'staff') {
      res.status(403).json({ error: 'Only an admin or superadmin can change a username.' });
      return;
    }
    const updated = await updateUser(req.user!.sub, { firstName, lastName, username, avatar });
    if (!updated) {
      res.status(401).json({ error: 'User no longer exists' });
      return;
    }
    res.json({ user: updated });
  } catch (err) {
    if (err instanceof Error && err.message.includes('users_username_key')) {
      res.status(400).json({ error: 'Username is already taken.' });
      return;
    }
    next(err);
  }
});

router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || typeof currentPassword !== 'string') {
      res.status(400).json({ error: '"currentPassword" is required' });
      return;
    }
    if (typeof newPassword !== 'string' || !isStrongPassword(newPassword)) {
      res.status(400).json({
        error:
          'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.',
      });
      return;
    }

    const row = await getUserByIdWithHash(req.user!.sub);
    if (!row) {
      res.status(401).json({ error: 'User no longer exists' });
      return;
    }
    const valid = await bcrypt.compare(currentPassword, row.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }

    await updateUser(row.id, { password: newPassword });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
