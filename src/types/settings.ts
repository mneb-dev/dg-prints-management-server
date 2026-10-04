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
  /** Online shop convenience fee (% of items + shipping) added when the buyer pays through PayMongo; 0 = off. */
  convenienceFeePercent: number;
  /** Online payment options the shop's checkout lists (PayMongo types, display order; first = default).
   *  Separate from the payment_methods catalog staff use on orders. */
  shopPaymentMethods: string[];
  updatedAt: string;
}

export type AppSettingsInput = Partial<
  Pick<AppSettings, 'shippingFee' | 'shippingRates' | 'messengerUrl' | 'convenienceFeePercent' | 'shopPaymentMethods'>
>;
