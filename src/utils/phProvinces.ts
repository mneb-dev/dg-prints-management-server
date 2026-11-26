export type ShippingRegion = 'luzon' | 'visayas' | 'mindanao';

export interface Province {
  name: string;
  region: ShippingRegion;
}

// Every PH province (plus Metro Manila), grouped by the island group that sets its shipping fee.
// The online shop's checkout lists these via GET /api/shop/shipping — this is the only copy.
const LUZON = [
  'Metro Manila',
  'Abra', 'Albay', 'Apayao', 'Aurora', 'Bataan', 'Batanes', 'Batangas', 'Benguet', 'Bulacan',
  'Cagayan', 'Camarines Norte', 'Camarines Sur', 'Catanduanes', 'Cavite', 'Ifugao', 'Ilocos Norte',
  'Ilocos Sur', 'Isabela', 'Kalinga', 'La Union', 'Laguna', 'Marinduque', 'Masbate', 'Mountain Province',
  'Nueva Ecija', 'Nueva Vizcaya', 'Occidental Mindoro', 'Oriental Mindoro', 'Palawan', 'Pampanga',
  'Pangasinan', 'Quezon', 'Quirino', 'Rizal', 'Romblon', 'Sorsogon', 'Tarlac', 'Zambales',
];
const VISAYAS = [
  'Aklan', 'Antique', 'Biliran', 'Bohol', 'Capiz', 'Cebu', 'Eastern Samar', 'Guimaras', 'Iloilo',
  'Leyte', 'Negros Occidental', 'Negros Oriental', 'Northern Samar', 'Samar', 'Siquijor', 'Southern Leyte',
];
const MINDANAO = [
  'Agusan del Norte', 'Agusan del Sur', 'Basilan', 'Bukidnon', 'Camiguin', 'Cotabato', 'Davao de Oro',
  'Davao del Norte', 'Davao del Sur', 'Davao Occidental', 'Davao Oriental', 'Dinagat Islands',
  'Lanao del Norte', 'Lanao del Sur', 'Maguindanao del Norte', 'Maguindanao del Sur', 'Misamis Occidental',
  'Misamis Oriental', 'Sarangani', 'South Cotabato', 'Sultan Kudarat', 'Sulu', 'Surigao del Norte',
  'Surigao del Sur', 'Tawi-Tawi', 'Zamboanga del Norte', 'Zamboanga del Sur', 'Zamboanga Sibugay',
];

export const PROVINCES: Province[] = [
  ...LUZON.map((name) => ({ name, region: 'luzon' as const })),
  ...VISAYAS.map((name) => ({ name, region: 'visayas' as const })),
  ...MINDANAO.map((name) => ({ name, region: 'mindanao' as const })),
];

const PROVINCE_BY_NAME = new Map(PROVINCES.map((province) => [province.name.toLowerCase(), province]));

export function regionOfProvince(name: string): ShippingRegion | undefined {
  return PROVINCE_BY_NAME.get(name.trim().toLowerCase())?.region;
}

/** The list's own spelling of a province name, matched case-insensitively ("metro manila" → "Metro Manila"). */
export function canonicalProvinceName(name: string): string | undefined {
  return PROVINCE_BY_NAME.get(name.trim().toLowerCase())?.name;
}

/**
 * SPX Express still uses these older province names; the portal's address picker uses SPX's spellings
 * (from SPX's mass-order template), so portal orders may carry them. Each maps to the province above that
 * covers the same area. ("Del" vs "del" differences need no entry — matching ignores case.)
 */
export const SPX_PROVINCE_ALIASES: Record<string, string> = {
  'Compostela Valley': 'Davao de Oro',
  'North Cotabato': 'Cotabato',
  'Western Samar': 'Samar',
  Maguindanao: 'Maguindanao del Norte',
};
const ALIAS_BY_NAME = new Map(Object.entries(SPX_PROVINCE_ALIASES).map(([spx, ours]) => [spx.toLowerCase(), ours]));

/** A province name the portal may send: one above (any case) or an SPX spelling from SPX_PROVINCE_ALIASES. */
export function isKnownProvince(name: string): boolean {
  const key = name.trim().toLowerCase();
  return PROVINCE_BY_NAME.has(key) || ALIAS_BY_NAME.has(key);
}
