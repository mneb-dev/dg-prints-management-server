export interface AppSettings {
  shippingFee: number;
  updatedAt: string;
}

export type AppSettingsInput = Pick<AppSettings, 'shippingFee'>;
