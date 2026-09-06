export const EXPENSE_CATEGORIES = [
  'Travel and Transportation',
  "Office and Facilities",
  'Office Supplies and Equipment',
  'Payroll and Employee Costs',
  'Sales and Marketing',
  'Professional Services',
  'Insurance and Compliance',
  'Others',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

// Payment methods are a shared, admin-managed catalog (see the payment_methods
// table / catalogRoutes.ts) — same one used by orders, not an expense-specific enum.

export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export interface Expense {
  id: string;
  date: string;
  amount: number;
  category: string;
  paymentMethod: string;
  notes: string;
  createdBy: string | null;
  createdByName: string;
  recurringExpenseId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ExpenseInput = Partial<
  Omit<Expense, 'id' | 'createdBy' | 'createdByName' | 'recurringExpenseId' | 'createdAt' | 'updatedAt'>
>;

export interface RecurringExpense {
  id: string;
  amount: number;
  category: string;
  paymentMethod: string;
  notes: string;
  frequency: RecurrenceFrequency;
  startDate: string;
  nextRunDate: string;
  active: boolean;
  createdBy: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export type RecurringExpenseInput = Partial<
  Omit<RecurringExpense, 'id' | 'nextRunDate' | 'createdBy' | 'createdByName' | 'createdAt' | 'updatedAt'>
>;
