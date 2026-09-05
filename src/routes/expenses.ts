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
import { requireAuth, requireRole } from '../middleware/auth.js';
import { EXPENSE_CATEGORIES, EXPENSE_PAYMENT_METHODS, RECURRENCE_FREQUENCIES } from '../types/expense.js';
import { parsePage, parsePageSize, parseSortBy, parseSortDir, queryString } from './pagination.js';

const router = Router();

router.use(requireAuth);

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

function validatePaymentMethod(paymentMethod: unknown): string | null {
  if (
    typeof paymentMethod !== 'string' ||
    !EXPENSE_PAYMENT_METHODS.includes(paymentMethod as (typeof EXPENSE_PAYMENT_METHODS)[number])
  ) {
    return `"paymentMethod" must be one of ${EXPENSE_PAYMENT_METHODS.join(', ')}`;
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

router.put('/:id', requireRole('admin', 'superadmin'), async (req, res, next) => {
  try {
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
