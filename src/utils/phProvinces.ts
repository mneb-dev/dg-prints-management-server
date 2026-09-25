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

const REGION_BY_PROVINCE = new Map(PROVINCES.map((province) => [province.name.toLowerCase(), province.region]));

export function regionOfProvince(name: string): ShippingRegion | undefined {
  return REGION_BY_PROVINCE.get(name.trim().toLowerCase());
}
