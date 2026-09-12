import { supabase } from '../config/supabaseClient.js';

export interface CommissionSummaryRow {
  layoutBy: string;
  layoutByName: string;
  paidCommission: number;
  paidOrderCount: number;
  unpaidCommission: number;
  unpaidOrderCount: number;
  totalCommission: number;
  totalOrderCount: number;
  releasedCommission: number;
  releasedOrderCount: number;
  pendingReleaseCommission: number;
  pendingReleaseOrderCount: number;
}

interface CommissionSummaryRawRow {
  layoutBy: string;
  layoutByName: string;
  paidCommission: number | string;
  paidOrderCount: number | string;
  unpaidCommission: number | string;
  unpaidOrderCount: number | string;
  totalCommission: number | string;
  totalOrderCount: number | string;
  releasedCommission: number | string;
  releasedOrderCount: number | string;
  pendingReleaseCommission: number | string;
  pendingReleaseOrderCount: number | string;
}

export async function getCommissionSummary(
  dateFrom: string,
  dateTo: string,
  layoutBy?: string
): Promise<CommissionSummaryRow[]> {
  const { data, error } = await supabase.rpc('commission_summary', {
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_layout_by: layoutBy ?? null,
  });
  if (error) throw new Error(error.message);
  const rows = (data as unknown as CommissionSummaryRawRow[]) ?? [];
  return rows.map((row) => ({
    layoutBy: row.layoutBy,
    layoutByName: row.layoutByName,
    paidCommission: Number(row.paidCommission ?? 0),
    paidOrderCount: Number(row.paidOrderCount ?? 0),
    unpaidCommission: Number(row.unpaidCommission ?? 0),
    unpaidOrderCount: Number(row.unpaidOrderCount ?? 0),
    totalCommission: Number(row.totalCommission ?? 0),
    totalOrderCount: Number(row.totalOrderCount ?? 0),
    releasedCommission: Number(row.releasedCommission ?? 0),
    releasedOrderCount: Number(row.releasedOrderCount ?? 0),
    pendingReleaseCommission: Number(row.pendingReleaseCommission ?? 0),
    pendingReleaseOrderCount: Number(row.pendingReleaseOrderCount ?? 0),
  }));
}

export interface CommissionOrderRow {
  id: string;
  orderNumber: string;
  customerName: string;
  layoutFee: number;
  commissionRate: number;
  commissionAmount: number;
  paymentStatus: string;
  layoutBy: string;
  layoutByName: string;
  createdAt: string;
  releasedAt: string | null;
  releasedBy: string | null;
  releasedByName: string | null;
}

interface CommissionOrderRawRow {
  id: string;
  orderNumber: string;
  customerName: string;
  layoutFee: number | string;
  commissionRate: number | string;
  commissionAmount: number | string;
  paymentStatus: string;
  layoutBy: string;
  layoutByName: string;
  createdAt: string;
  releasedAt: string | null;
  releasedBy: string | null;
  releasedByName: string | null;
}

export async function listCommissionOrders(
  dateFrom: string,
  dateTo: string,
  layoutBy?: string
): Promise<CommissionOrderRow[]> {
  const { data, error } = await supabase.rpc('list_commission_orders', {
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_layout_by: layoutBy ?? null,
  });
  if (error) throw new Error(error.message);
  const rows = (data as unknown as CommissionOrderRawRow[]) ?? [];
  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.orderNumber,
    customerName: row.customerName,
    layoutFee: Number(row.layoutFee ?? 0),
    commissionRate: Number(row.commissionRate ?? 0),
    commissionAmount: Number(row.commissionAmount ?? 0),
    paymentStatus: row.paymentStatus,
    layoutBy: row.layoutBy,
    layoutByName: row.layoutByName,
    createdAt: row.createdAt,
    releasedAt: row.releasedAt,
    releasedBy: row.releasedBy,
    releasedByName: row.releasedByName,
  }));
}

export interface MonthlyIncentiveTier {
  threshold: number;
  amount: number;
  progressPercent: number;
  isMet: boolean;
}

export interface MonthlyIncentiveStaffShare {
  userId: string;
  name: string;
  ownSales: number;
  percentageShare: number;
  commissionShare: number;
}

export interface MonthlyIncentiveOwnShare {
  ownSales: number;
  percentageShare: number;
  commissionShare: number;
}

export interface MonthlyIncentiveSummary {
  totalStaffSales: number;
  pool: number;
  tiers: MonthlyIncentiveTier[];
  perStaff: MonthlyIncentiveStaffShare[];
  // The calling user's own row, resolved server-side regardless of role -- lets a staff caller
  // see their own contribution/share even though perStaff (everyone's) is stripped for them.
  // Null when the caller has no eligible sales in the period (e.g. an admin, or a staff member
  // with no paid orders yet).
  ownShare: MonthlyIncentiveOwnShare | null;
  releasedAt: string | null;
  releasedBy: string | null;
  releasedByName: string | null;
}

interface MonthlyIncentiveSummaryRawRow {
  totalStaffSales: number | string;
  pool: number | string;
  tiers: { threshold: number | string; amount: number | string; progressPercent: number | string; isMet: boolean }[];
  perStaff: {
    userId: string;
    name: string;
    ownSales: number | string;
    percentageShare: number | string;
    commissionShare: number | string;
  }[];
  ownShare: { ownSales: number | string; percentageShare: number | string; commissionShare: number | string } | null;
  releasedAt: string | null;
  releasedBy: string | null;
  releasedByName: string | null;
}

/**
 * Team-wide monthly incentive tier summary (see the monthly_incentive_summary migration for the
 * full eligibility/math contract). Unlike getCommissionSummary, this returns one object, not one
 * row per staff member -- the tier ladder and pool are inherently team-wide.
 */
export async function getMonthlyIncentiveSummary(
  dateFrom: string,
  dateTo: string,
  callerId: string
): Promise<MonthlyIncentiveSummary> {
  const { data, error } = await supabase.rpc('monthly_incentive_summary', {
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_caller_id: callerId,
  });
  if (error) throw new Error(error.message);
  const row = (data as unknown as MonthlyIncentiveSummaryRawRow) ?? {
    totalStaffSales: 0,
    pool: 0,
    tiers: [],
    perStaff: [],
    ownShare: null,
    releasedAt: null,
    releasedBy: null,
    releasedByName: null,
  };
  return {
    totalStaffSales: Number(row.totalStaffSales ?? 0),
    pool: Number(row.pool ?? 0),
    tiers: (row.tiers ?? []).map((t) => ({
      threshold: Number(t.threshold ?? 0),
      amount: Number(t.amount ?? 0),
      progressPercent: Number(t.progressPercent ?? 0),
      isMet: Boolean(t.isMet),
    })),
    perStaff: (row.perStaff ?? []).map((s) => ({
      userId: s.userId,
      name: s.name,
      ownSales: Number(s.ownSales ?? 0),
      percentageShare: Number(s.percentageShare ?? 0),
      commissionShare: Number(s.commissionShare ?? 0),
    })),
    ownShare: row.ownShare
      ? {
          ownSales: Number(row.ownShare.ownSales ?? 0),
          percentageShare: Number(row.ownShare.percentageShare ?? 0),
          commissionShare: Number(row.ownShare.commissionShare ?? 0),
        }
      : null,
    releasedAt: row.releasedAt ?? null,
    releasedBy: row.releasedBy ?? null,
    releasedByName: row.releasedByName ?? null,
  };
}

/**
 * Releases the monthly incentive pool for the calendar month containing dateFrom, via the
 * release_monthly_incentive RPC: snapshots the current total staff sales and per-staff split and
 * creates one expense per staff member (same "one expense per staff group" convention as
 * releaseCommissionOrders). Throws if that month was already released or if no tier has been
 * unlocked yet -- unlike per-order release, this isn't a batch that silently skips ineligible
 * entries, since there's only ever one release per month.
 */
export async function releaseMonthlyIncentive(
  dateFrom: string,
  dateTo: string,
  actorId: string
): Promise<{ releaseId: string; periodMonth: string }> {
  const { data, error } = await supabase.rpc('release_monthly_incentive', {
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_actor_id: actorId,
  });
  if (error) throw new Error(error.message);
  const row = data as unknown as { releaseId: string; periodMonth: string };
  return { releaseId: row.releaseId, periodMonth: row.periodMonth };
}

/**
 * Reverses releaseMonthlyIncentive for the calendar month containing dateFrom: deletes the
 * expenses it created and the release/share rows, via the unrelease_monthly_incentive RPC.
 */
export async function unreleaseMonthlyIncentive(
  dateFrom: string,
  dateTo: string
): Promise<{ unreleased: boolean; periodMonth: string | null }> {
  const { data, error } = await supabase.rpc('unrelease_monthly_incentive', {
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  if (error) throw new Error(error.message);
  const row = data as unknown as { unreleased: boolean; periodMonth: string | null };
  return { unreleased: row.unreleased, periodMonth: row.periodMonth ?? null };
}

export interface MonthlyIncentiveHistoryEntry {
  periodMonth: string;
  totalStaffSales: number;
  pool: number;
  releasedAt: string | null;
  releasedBy: string | null;
  releasedByName: string | null;
  isCurrentMonth: boolean;
}

interface MonthlyIncentiveHistoryRawEntry {
  periodMonth: string;
  totalStaffSales: number | string;
  pool: number | string;
  releasedAt: string | null;
  releasedBy: string | null;
  releasedByName: string | null;
  isCurrentMonth: boolean;
}

/**
 * One row per calendar month of `year` (Jan through the current month if `year` is this year,
 * otherwise all 12), via the monthly_incentive_history RPC -- for the admin/superadmin release
 * history table. Each entry's isCurrentMonth flags the one month release_monthly_incentive will
 * always refuse, so the route/frontend can grey out its action instead of surprising the admin
 * with an error on click.
 */
export async function getMonthlyIncentiveHistory(year: number): Promise<MonthlyIncentiveHistoryEntry[]> {
  const { data, error } = await supabase.rpc('monthly_incentive_history', { p_year: year });
  if (error) throw new Error(error.message);
  const rows = (data as unknown as MonthlyIncentiveHistoryRawEntry[]) ?? [];
  return rows.map((row) => ({
    periodMonth: row.periodMonth,
    totalStaffSales: Number(row.totalStaffSales ?? 0),
    pool: Number(row.pool ?? 0),
    releasedAt: row.releasedAt ?? null,
    releasedBy: row.releasedBy ?? null,
    releasedByName: row.releasedByName ?? null,
    isCurrentMonth: Boolean(row.isCurrentMonth),
  }));
}

/**
 * Releases a batch of paid, not-yet-released orders' commission via the release_commission_orders
 * RPC (not a direct update -- computing each order's locked-in amount needs a cross-table read of
 * the layout_by user's current commission_rate, done atomically in one statement to avoid a
 * read-then-write race with a concurrent rate edit). Returns only the ids actually released --
 * orders that aren't payment_status = 'paid' or are already released are silently skipped.
 */
export async function releaseCommissionOrders(orderIds: string[], actorId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('release_commission_orders', {
    p_order_ids: orderIds,
    p_actor_id: actorId,
  });
  if (error) throw new Error(error.message);
  return (data as unknown as string[]) ?? [];
}

/**
 * Clears release tracking on a batch of orders via the unrelease_commission_orders RPC. Unlike
 * releaseCommissionOrders' sibling, this can't be a plain direct update anymore -- it also has to
 * shrink or delete the expense(s) those orders' commission was folded into at release time, so
 * the order and expense sides never drift apart.
 */
export async function unreleaseCommissionOrders(orderIds: string[]): Promise<string[]> {
  const { data, error } = await supabase.rpc('unrelease_commission_orders', {
    p_order_ids: orderIds,
  });
  if (error) throw new Error(error.message);
  return (data as unknown as string[]) ?? [];
}
