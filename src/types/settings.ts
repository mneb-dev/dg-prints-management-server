import type { ShippingRegion } from '../utils/phProvinces.js';

/** Online shop shipping fee per island group, picked from the buyer's province at checkout. */
export type ShippingRates = Record<ShippingRegion, number>;

export interface AppSettings {
  /** Default shipping fee on the portal's order form. */
  shippingFee: number;
  /** Online shop shipping fees (Luzon / Visayas / Mindanao). */
  shippingRates: ShippingRates;
  /** Messenger link for the online shop's "Message us on Facebook" button; '' = not configured. */
  messengerUrl: string;
  updatedAt: string;
}

export type AppSettingsInput = Partial<Pick<AppSettings, 'shippingFee' | 'shippingRates' | 'messengerUrl'>>;
