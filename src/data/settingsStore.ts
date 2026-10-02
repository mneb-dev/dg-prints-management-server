import { supabase } from '../config/supabaseClient.js';
import type { AppSettings, AppSettingsInput } from '../types/settings.js';

const SETTINGS_SELECT =
  'shipping_fee, shipping_fee_luzon, shipping_fee_visayas, shipping_fee_mindanao, messenger_url, ' +
  'convenience_fee_percent, shop_payment_methods, updated_at';

interface AppSettingsRow {
  shipping_fee: number;
  shipping_fee_luzon: number | string;
  shipping_fee_visayas: number | string;
  shipping_fee_mindanao: number | string;
  messenger_url: string | null;
  convenience_fee_percent: number | string;
  shop_payment_methods: string[] | null;
  updated_at: string;
}

function mapRowToSettings(row: AppSettingsRow): AppSettings {
  return {
    shippingFee: Number(row.shipping_fee),
    shippingRates: {
      luzon: Number(row.shipping_fee_luzon),
      visayas: Number(row.shipping_fee_visayas),
      mindanao: Number(row.shipping_fee_mindanao),
    },
    messengerUrl: row.messenger_url ?? '',
    convenienceFeePercent: Number(row.convenience_fee_percent ?? 0),
    shopPaymentMethods: row.shop_payment_methods ?? ['gcash'],
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
  const patch: Record<string, unknown> = {};
  if (input.shippingFee !== undefined) patch.shipping_fee = input.shippingFee;
  if (input.shippingRates !== undefined) {
    patch.shipping_fee_luzon = input.shippingRates.luzon;
    patch.shipping_fee_visayas = input.shippingRates.visayas;
    patch.shipping_fee_mindanao = input.shippingRates.mindanao;
  }
  if (input.messengerUrl !== undefined) patch.messenger_url = input.messengerUrl;
  if (input.convenienceFeePercent !== undefined) patch.convenience_fee_percent = input.convenienceFeePercent;
  if (input.shopPaymentMethods !== undefined) patch.shop_payment_methods = input.shopPaymentMethods;
  const { data, error } = await supabase
    .from('app_settings')
    .update(patch)
    .eq('id', 'default')
    .select(SETTINGS_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return mapRowToSettings(data as unknown as AppSettingsRow);
}
