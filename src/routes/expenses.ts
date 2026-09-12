import { Router } from 'express';

import {
  createExpense,
  deleteExpense,
  getExpense,
  listExpenses,
  updateExpense,
} from '../data/expenseStore.js';
import {
  createRecurringExpense,
  deleteRecurringExpense,
  listRecurringExpenses,
  updateRecurringExpense,
} from '../data/recurringExpenseStore.js';
import { requireAuth, requirePermission, requireRole } from '../middleware/auth.js';
import { EXPENSE_CATEGORIES, RECURRENCE_FREQUENCIES } from '../types/expense.js';
import type { ExpenseAutoSource } from '../types/expense.js';
import { parsePage, parsePageSize, parseSortBy, parseSortDir, queryString } from './pagination.js';

const router = Router();

router.use(requireAuth, requirePermission('manage_expenses'));

const EXPENSE_SORT_KEYS = ['date', 'amount', 'category', 'created_at'] as const;

function validateAmount(amount: unknown): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return '"amount" must be a number greater than 0';
  }
  return null;
}

function validateCategory(category: unknown): string | null {
  if (typeof category !== 'string' || !EXPENSE_CATEGORIES.includes(category as (typeof EXPENSE_CATEGORIES)[number])) {
    return `"category" must be one of ${EXPENSE_CATEGORIES.join(', ')}`;
  }
  return null;
}

// Payment methods are now a shared, admin-managed catalog (see payment_methods
// table / catalogRoutes.ts) rather than a fixed enum — same leniency as orders.ts,
// which likewise doesn't check `payment_method` against the catalog server-side.
function validatePaymentMethod(paymentMethod: unknown): string | null {
  if (typeof paymentMethod !== 'string' || !paymentMethod.trim()) {
    return '"paymentMethod" is required';
  }
  return null;
}

function validateDate(date: unknown): string | null {
  if (typeof date !== 'string' || Number.isNaN(Date.parse(date))) {
    return '"date" must be a valid date';
  }
  return null;
}

function validateNotes(notes: unknown): string | null {
  if (notes === undefined || notes === null) return null;
  if (typeof notes !== 'string' || notes.length > 300) {
    return '"notes" must be a string of at most 300 characters';
  }
  return null;
}

function validateFrequency(frequency: unknown): string | null {
  if (
    typeof frequency !== 'string' ||
    !RECURRENCE_FREQUENCIES.includes(frequency as (typeof RECURRENCE_FREQUENCIES)[number])
  ) {
    return `"frequency" must be one of ${RECURRENCE_FREQUENCIES.join(', ')}`;
  }
  return null;
}

// Registered before '/:id' so "recurring" isn't matched as an expense id.
router.get('/recurring', requireRole('admin', 'superadmin'), async (_req, res, next) => {
  try {
    const items = await listRecurringExpenses();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.post('/recurring', requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const amountError = validateAmount(req.body?.amount);
    if (amountError) {
      res.status(400).json({ error: amountError });
      return;
    }
    const categoryError = validateCategory(req.body?.category);
    if (categoryError) {
      res.status(400).json({ error: categoryError });
      return;
    }
    const paymentMethodError = validatePaymentMethod(req.body?.paymentMethod);
    if (paymentMethodError) {
      res.status(400).json({ error: paymentMethodError });
      return;
    }
    const frequencyError = validateFrequency(req.body?.frequency);
    if (frequencyError) {
      res.status(400).json({ error: frequencyError });
      return;
    }
    const startDateError = validateDate(req.body?.startDate);
    if (startDateError) {
      res.status(400).json({ error: startDateError });
      return;
    }
    const notesError = validateNotes(req.body?.notes);
    if (notesError) {
      res.status(400).json({ error: notesError });
      return;
    }
    const recurring = await createRecurringExpense(req.body, req.user!.sub);
    res.status(201).json(recurring);
  } catch (err) {
    next(err);
  }
});

router.put('/recurring/:id', requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    if (req.body?.amount !== undefined) {
      const amountError = validateAmount(req.body.amount);
      if (amountError) {
        res.status(400).json({ error: amountError });
        return;
      }
    }
    if (req.body?.category !== undefined) {
      const categoryError = validateCategory(req.body.category);
      if (categoryError) {
        res.status(400).json({ error: categoryError });
        return;
      }
    }
    if (req.body?.paymentMethod !== undefined) {
      const paymentMethodError = validatePaymentMethod(req.body.paymentMethod);
      if (paymentMethodError) {
        res.status(400).json({ error: paymentMethodError });
        return;
      }
    }
    if (req.body?.frequency !== undefined) {
      const frequencyError = validateFrequency(req.body.frequency);
      if (frequencyError) {
        res.status(400).json({ error: frequencyError });
        return;
      }
    }
    if (req.body?.startDate !== undefined) {
      const startDateError = validateDate(req.body.startDate);
      if (startDateError) {
        res.status(400).json({ error: startDateError });
        return;
      }
    }
    const notesError = validateNotes(req.body?.notes);
    if (notesError) {
      res.status(400).json({ error: notesError });
      return;
    }
    const updated = await updateRecurringExpense(req.params.id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: `Recurring expense not found: ${req.params.id}` });
      return;
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/recurring/:id', requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const deleted = await deleteRecurringExpense(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: `Recurring expense not found: ${req.params.id}` });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const parsedPageSize = parsePageSize(req.query.pageSize);
    if (typeof parsedPageSize !== 'number') {
      res.status(400).json({ error: parsedPageSize.error });
      return;
    }
    const page = parsePage(req.query.page);

    // Staff can only ever see their own expenses, regardless of what's passed in the query.
    const createdBy =
      req.user!.role === 'staff' ? req.user!.sub : queryString(req.query.createdBy) || undefined;

    const result = await listExpenses({
      page,
      pageSize: parsedPageSize,
      search: queryString(req.query.search),
      category: queryString(req.query.category),
      paymentMethod: queryString(req.query.paymentMethod),
      dateFrom: queryString(req.query.dateFrom) || undefined,
      dateTo: queryString(req.query.dateTo) || undefined,
      createdBy,
      sortBy: parseSortBy(req.query.sortBy, EXPENSE_SORT_KEYS, 'date'),
      sortDir: parseSortDir(req.query.sortDir),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const expense = await getExpense(req.params.id);
    if (!expense) {
      res.status(404).json({ error: `Expense not found: ${req.params.id}` });
      return;
    }
    if (req.user!.role === 'staff' && expense.createdBy !== req.user!.sub) {
      res.status(403).json({ error: 'You can only view your own expenses' });
      return;
    }
    res.json(expense);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const dateError = validateDate(req.body?.date);
    if (dateError) {
      res.status(400).json({ error: dateError });
      return;
    }
    const amountError = validateAmount(req.body?.amount);
    if (amountError) {
      res.status(400).json({ error: amountError });
      return;
    }
    const categoryError = validateCategory(req.body?.category);
    if (categoryError) {
      res.status(400).json({ error: categoryError });
      return;
    }
    const paymentMethodError = validatePaymentMethod(req.body?.paymentMethod);
    if (paymentMethodError) {
      res.status(400).json({ error: paymentMethodError });
      return;
    }
    const notesError = validateNotes(req.body?.notes);
    if (notesError) {
      res.status(400).json({ error: notesError });
      return;
    }
    const expense = await createExpense(req.body, req.user!.sub);
    res.status(201).json(expense);
  } catch (err) {
    next(err);
  }
});

// Keyed by autoGeneratedSource (see expenseStore.ts's mapRowToExpense) so the PUT/DELETE guards
// below stay a single check each instead of an inline commissionOrderIds check that would need
// updating at every call site (here, and the frontend's badge/tooltip/banner) if a second
// auto-source is ever added.
const AUTO_LOCK_ERRORS: Record<ExpenseAutoSource, { edit: string; delete: string }> = {
  commission_release: {
    edit:
      'This expense was generated by a commission release — amount, category, and date can only change ' +
      'via Release/Undo Release on the Incentives page.',
    delete: 'This expense was generated by a commission release — undo the release on the Incentives page to remove it.',
  },
  monthly_incentive_release: {
    edit:
      'This expense was generated by a monthly incentive release — amount, category, and date can only change ' +
      'via Release/Undo Release on the Incentives page.',
    delete:
      'This expense was generated by a monthly incentive release — undo the release on the Incentives page to remove it.',
  },
};

router.put('/:id', requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const existing = await getExpense(req.params.id);
    if (!existing) {
      res.status(404).json({ error: `Expense not found: ${req.params.id}` });
      return;
    }
    if (existing.autoGeneratedSource) {
      // The frontend always resends the full ExpenseInput shape (not a partial diff), so only
      // reject when a locked field's value would actually change -- resubmitting the unchanged
      // amount/category/date alongside an edited payment method/notes must still succeed.
      const changesLockedField =
        (req.body?.amount !== undefined && req.body.amount !== existing.amount) ||
        (req.body?.category !== undefined && req.body.category !== existing.category) ||
        (req.body?.date !== undefined && req.body.date !== existing.date);
      if (changesLockedField) {
        res.status(400).json({ error: AUTO_LOCK_ERRORS[existing.autoGeneratedSource].edit });
        return;
      }
    }
    if (req.body?.date !== undefined) {
      const dateError = validateDate(req.body.date);
      if (dateError) {
        res.status(400).json({ error: dateError });
        return;
      }
    }
    if (req.body?.amount !== undefined) {
      const amountError = validateAmount(req.body.amount);
      if (amountError) {
        res.status(400).json({ error: amountError });
        return;
      }
    }
    if (req.body?.category !== undefined) {
      const categoryError = validateCategory(req.body.category);
      if (categoryError) {
        res.status(400).json({ error: categoryError });
        return;
      }
    }
    if (req.body?.paymentMethod !== undefined) {
      const paymentMethodError = validatePaymentMethod(req.body.paymentMethod);
      if (paymentMethodError) {
        res.status(400).json({ error: paymentMethodError });
        return;
      }
    }
    const notesError = validateNotes(req.body?.notes);
    if (notesError) {
      res.status(400).json({ error: notesError });
      return;
    }
    const updated = await updateExpense(req.params.id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: `Expense not found: ${req.params.id}` });
      return;
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const existing = await getExpense(req.params.id);
    if (existing?.autoGeneratedSource) {
      res.status(409).json({ error: AUTO_LOCK_ERRORS[existing.autoGeneratedSource].delete });
      return;
    }
    const deleted = await deleteExpense(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: `Expense not found: ${req.params.id}` });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
