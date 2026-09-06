import { randomUUID } from 'node:crypto';

import { supabase } from '../config/supabaseClient.js';
import type { RecurringExpense, RecurringExpenseInput } from '../types/expense.js';
import { getUser } from './userStore.js';

interface RecurringExpenseRow {
  id: string;
  amount: number | string;
  category: string;
  payment_method: string;
  notes: string;
  frequency: RecurringExpense['frequency'];
  start_date: string;
  next_run_date: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const RECURRING_EXPENSE_SELECT =
  'id, amount, category, payment_method, notes, frequency, start_date, next_run_date, active, created_by, created_at, updated_at';

function mapRowToRecurringExpense(row: RecurringExpenseRow): RecurringExpense {
  return {
    id: row.id,
    amount: Number(row.amount),
    category: row.category,
    paymentMethod: row.payment_method,
    notes: row.notes,
    frequency: row.frequency,
    startDate: row.start_date,
    nextRunDate: row.next_run_date,
    active: row.active,
    createdBy: row.created_by,
    createdByName: '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function resolveActorName(actorId: string): Promise<string> {
  const user = await getUser(actorId);
  return user ? `${user.firstName} ${user.lastName}`.trim() : '';
}

async function withCreatedByName(expense: RecurringExpense): Promise<RecurringExpense> {
  const createdByName = expense.createdBy ? await resolveActorName(expense.createdBy) : '';
  return { ...expense, createdByName };
}

export async function listRecurringExpenses(): Promise<RecurringExpense[]> {
  const { data, error } = await supabase
    .from('recurring_expenses')
    .select(RECURRING_EXPENSE_SELECT)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data as unknown as RecurringExpenseRow[]).map(mapRowToRecurringExpense);
  return Promise.all(rows.map(withCreatedByName));
}

export async function getRecurringExpense(id: string): Promise<RecurringExpense | undefined> {
  const { data, error } = await supabase
    .from('recurring_expenses')
    .select(RECURRING_EXPENSE_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return undefined;
  return withCreatedByName(mapRowToRecurringExpense(data as unknown as RecurringExpenseRow));
}

export async function createRecurringExpense(
  input: RecurringExpenseInput,
  actorId: string
): Promise<RecurringExpense> {
  const { data, error } = await supabase
    .from('recurring_expenses')
    .insert({
      id: randomUUID(),
      amount: input.amount,
      category: input.category,
      payment_method: input.paymentMethod,
      notes: input.notes ?? '',
      frequency: input.frequency,
      start_date: input.startDate,
      next_run_date: input.startDate,
      active: input.active ?? true,
      created_by: actorId,
    })
    .select(RECURRING_EXPENSE_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return withCreatedByName(mapRowToRecurringExpense(data as unknown as RecurringExpenseRow));
}

export async function updateRecurringExpense(
  id: string,
  input: RecurringExpenseInput
): Promise<RecurringExpense | undefined> {
  const update: Record<string, unknown> = {};
  if (input.amount !== undefined) update.amount = input.amount;
  if (input.category !== undefined) update.category = input.category;
  if (input.paymentMethod !== undefined) update.payment_method = input.paymentMethod;
  if (input.notes !== undefined) update.notes = input.notes;
  if (input.frequency !== undefined) update.frequency = input.frequency;
  if (input.startDate !== undefined) update.start_date = input.startDate;
  if (input.active !== undefined) update.active = input.active;

  const { data, error } = await supabase
    .from('recurring_expenses')
    .update(update)
    .eq('id', id)
    .select(RECURRING_EXPENSE_SELECT)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return undefined;
  return withCreatedByName(mapRowToRecurringExpense(data as unknown as RecurringExpenseRow));
}

export async function deleteRecurringExpense(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('recurring_expenses')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

export async function processRecurringExpenses(): Promise<number> {
  const { data, error } = await supabase.rpc('process_recurring_expenses');
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}
