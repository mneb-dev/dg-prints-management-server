import { supabase } from '../config/supabaseClient.js';

export interface FinanceSeriesPoint {
  date: string;
  revenue: number;
  expenses: number;
}

export interface FinanceSummary {
  range: { from: string; to: string };
  totalRevenue: number;
  revenueOrderCount: number;
  totalExpenses: number;
  expenseCount: number;
  netProfit: number;
  outstandingBalance: number;
  expensesByCategory: Record<string, number>;
  revenueByChannel: Record<string, number>;
  revenueByPaymentMethod: Record<string, number>;
  series: FinanceSeriesPoint[];
}

interface FinanceSummaryRow {
  range: { from: string; to: string };
  totalRevenue: number | string;
  revenueOrderCount: number | string;
  totalExpenses: number | string;
  expenseCount: number | string;
  netProfit: number | string;
  outstandingBalance: number | string;
  expensesByCategory: Record<string, number | string>;
  revenueByChannel: Record<string, number | string>;
  revenueByPaymentMethod: Record<string, number | string>;
  series: { date: string; revenue: number | string; expenses: number | string }[];
}

function toNumberMap(obj: Record<string, number | string>): Record<string, number> {
  return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, Number(value)]));
}

export async function getFinanceSummary(dateFrom: string, dateTo: string): Promise<FinanceSummary> {
  const { data, error } = await supabase.rpc('finance_summary', {
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  if (error) throw new Error(error.message);
  const row = data as unknown as FinanceSummaryRow;
  return {
    range: row.range,
    totalRevenue: Number(row.totalRevenue ?? 0),
    revenueOrderCount: Number(row.revenueOrderCount ?? 0),
    totalExpenses: Number(row.totalExpenses ?? 0),
    expenseCount: Number(row.expenseCount ?? 0),
    netProfit: Number(row.netProfit ?? 0),
    outstandingBalance: Number(row.outstandingBalance ?? 0),
    expensesByCategory: toNumberMap(row.expensesByCategory ?? {}),
    revenueByChannel: toNumberMap(row.revenueByChannel ?? {}),
    revenueByPaymentMethod: toNumberMap(row.revenueByPaymentMethod ?? {}),
    series: (row.series ?? []).map((p) => ({
      date: p.date,
      revenue: Number(p.revenue ?? 0),
      expenses: Number(p.expenses ?? 0),
    })),
  };
}
