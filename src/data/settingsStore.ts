import { supabase } from '../config/supabaseClient.js';
import type { AppSettings, AppSettingsInput } from '../types/settings.js';

const SETTINGS_SELECT = 'shipping_fee, updated_at';

interface AppSettingsRow {
  shipping_fee: number;
  updated_at: string;
}

function mapRowToSettings(row: AppSettingsRow): AppSettings {
  return {
    shippingFee: Number(row.shipping_fee),
    updatedAt: row.updated_at,
  };
}

export async function getSettings(): Promise<AppSettings> {
  const { data, error } = await supabase
    .from('app_settings')
    .select(SETTINGS_SELECT)
    .eq('id', 'default')
    .single();
  if (error) throw new Error(error.message);
  return mapRowToSettings(data as unknown as AppSettingsRow);
}

export async function updateSettings(input: AppSettingsInput): Promise<AppSettings> {
  const { data, error } = await supabase
    .from('app_settings')
    .update({ shipping_fee: input.shippingFee })
    .eq('id', 'default')
    .select(SETTINGS_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return mapRowToSettings(data as unknown as AppSettingsRow);
}
