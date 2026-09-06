import { randomUUID } from 'node:crypto';

import { supabase } from '../config/supabaseClient.js';
import type { Expense, ExpenseInput } from '../types/expense.js';
import { getUser } from './userStore.js';

interface ExpenseRow {
  id: string;
  date: string;
  amount: number | string;
  category: string;
  payment_method: string;
  notes: string;
  created_by: string | null;
  // Present (joined) on list_expenses' RPC rows; absent on getExpense's
  // plain-column select — getExpense resolves the name itself after fetching.
  created_by_name?: string;
  recurring_expense_id: string | null;
  created_at: string;
  updated_at: string;
}

const EXPENSE_SELECT =
  'id, date, amount, category, payment_method, notes, created_by, recurring_expense_id, created_at, updated_at';

function mapRowToExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    date: row.date,
    amount: Number(row.amount),
    category: row.category,
    paymentMethod: row.payment_method,
    notes: row.notes,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? '',
    recurringExpenseId: row.recurring_expense_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function resolveActorName(actorId: string): Promise<string> {
  const user = await getUser(actorId);
  return user ? `${user.firstName} ${user.lastName}`.trim() : '';
}

export interface ListExpensesParams {
  page: number;
  pageSize: number;
  search?: string;
  category?: string;
  paymentMethod?: string;
  dateFrom?: string;
  dateTo?: string;
  createdBy?: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

export interface ListExpensesResult {
  items: Expense[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listExpenses(params: ListExpensesParams): Promise<ListExpensesResult> {
  const { page, pageSize, search, category, paymentMethod, dateFrom, dateTo, createdBy, sortBy, sortDir } = params;
  const { data, error } = await supabase.rpc('list_expenses', {
    p_search: search || null,
    p_category: category || null,
    p_payment_method: paymentMethod || null,
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null,
    p_created_by: createdBy || null,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
    p_sort_by: sortBy,
    p_sort_dir: sortDir,
  });
  if (error) throw new Error(error.message);
  const payload = data as unknown as { rows: ExpenseRow[]; total: number };
  return {
    items: payload.rows.map(mapRowToExpense),
    total: payload.total,
    page,
    pageSize,
  };
}

export async function getExpense(id: string): Promise<Expense | undefined> {
  const { data, error } = await supabase
    .from('expenses')
    .select(EXPENSE_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return undefined;

  const expense = mapRowToExpense(data as unknown as ExpenseRow);
  const createdByName = expense.createdBy ? await resolveActorName(expense.createdBy) : '';
  return { ...expense, createdByName };
}

export async function createExpense(input: ExpenseInput, actorId: string): Promise<Expense> {
  const { data, error } = await supabase
    .from('expenses')
    .insert({
      id: randomUUID(),
      date: input.date,
      amount: input.amount,
      category: input.category,
      payment_method: input.paymentMethod,
      notes: input.notes ?? '',
      created_by: actorId,
    })
    .select(EXPENSE_SELECT)
    .single();
  if (error) throw new Error(error.message);

  const created = mapRowToExpense(data as unknown as ExpenseRow);
  return { ...created, createdByName: await resolveActorName(actorId) };
}

export async function updateExpense(id: string, input: ExpenseInput): Promise<Expense | undefined> {
  const update: Record<string, unknown> = {};
  if (input.date !== undefined) update.date = input.date;
  if (input.amount !== undefined) update.amount = input.amount;
  if (input.category !== undefined) update.category = input.category;
  if (input.paymentMethod !== undefined) update.payment_method = input.paymentMethod;
  if (input.notes !== undefined) update.notes = input.notes;

  const { data, error } = await supabase
    .from('expenses')
    .update(update)
    .eq('id', id)
    .select(EXPENSE_SELECT)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return undefined;

  const expense = mapRowToExpense(data as unknown as ExpenseRow);
  const createdByName = expense.createdBy ? await resolveActorName(expense.createdBy) : '';
  return { ...expense, createdByName };
}

export async function deleteExpense(id: string): Promise<boolean> {
  const { data, error } = await supabase.from('expenses').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}
