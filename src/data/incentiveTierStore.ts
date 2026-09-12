import { randomUUID } from 'node:crypto';

import { supabase } from '../config/supabaseClient.js';

export interface IncentiveTier {
  id: string;
  threshold: number;
  amount: number;
  createdAt: string;
  updatedAt: string;
}

export interface IncentiveTierInput {
  threshold: number;
  amount: number;
}

interface IncentiveTierRow {
  id: string;
  threshold: number | string;
  amount: number | string;
  created_at: string;
  updated_at: string;
}

const INCENTIVE_TIER_SELECT = 'id, threshold, amount, created_at, updated_at';

function mapRow(row: IncentiveTierRow): IncentiveTier {
  return {
    id: row.id,
    threshold: Number(row.threshold),
    amount: Number(row.amount),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Thrown by create/update when the threshold collides with another tier -- the tier lookup
 * ("highest threshold met") would otherwise be ambiguous between two rows at the same value. */
export class DuplicateIncentiveTierError extends Error {
  constructor(threshold: number) {
    super(`A tier at ₱${threshold.toLocaleString('en-PH')} already exists.`);
    this.name = 'DuplicateIncentiveTierError';
  }
}

function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === '23505';
}

export async function listIncentiveTiers(): Promise<IncentiveTier[]> {
  const { data, error } = await supabase
    .from('incentive_tiers')
    .select(INCENTIVE_TIER_SELECT)
    .order('threshold', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as unknown as IncentiveTierRow[]).map(mapRow);
}

export async function createIncentiveTier(input: IncentiveTierInput): Promise<IncentiveTier> {
  const { data, error } = await supabase
    .from('incentive_tiers')
    .insert({ id: randomUUID(), threshold: input.threshold, amount: input.amount })
    .select(INCENTIVE_TIER_SELECT)
    .single();
  if (error) {
    if (isUniqueViolation(error)) throw new DuplicateIncentiveTierError(input.threshold);
    throw new Error(error.message);
  }
  return mapRow(data as unknown as IncentiveTierRow);
}

export async function updateIncentiveTier(
  id: string,
  input: Partial<IncentiveTierInput>
): Promise<IncentiveTier | undefined> {
  const patch: Record<string, unknown> = {};
  if (input.threshold !== undefined) patch.threshold = input.threshold;
  if (input.amount !== undefined) patch.amount = input.amount;

  const { data, error } = await supabase
    .from('incentive_tiers')
    .update(patch)
    .eq('id', id)
    .select(INCENTIVE_TIER_SELECT)
    .maybeSingle();
  if (error) {
    if (isUniqueViolation(error)) throw new DuplicateIncentiveTierError(input.threshold ?? 0);
    throw new Error(error.message);
  }
  return data ? mapRow(data as unknown as IncentiveTierRow) : undefined;
}

export async function countIncentiveTiers(): Promise<number> {
  const { count, error } = await supabase
    .from('incentive_tiers')
    .select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function deleteIncentiveTier(id: string): Promise<boolean> {
  const { error, count } = await supabase.from('incentive_tiers').delete({ count: 'exact' }).eq('id', id);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}
