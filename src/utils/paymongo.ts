import { createHmac, timingSafeEqual } from 'node:crypto';

import { PAYMONGO_PAYMENT_METHODS, PAYMONGO_SECRET_KEY, PAYMONGO_WEBHOOK_SECRET } from '../config/env.js';

// Thin client for the bits of PayMongo's API the online shop uses (Checkout Sessions + webhooks).
// Docs: https://developers.paymongo.com/reference/checkout-session-resource

const API_BASE = 'https://api.paymongo.com/v1';

export class PayMongoError extends Error {}

export interface CheckoutLineItem {
  name: string;
  /** Smaller text under the name on PayMongo's page. */
  description?: string;
  /** Public https image URLs; PayMongo shows the first as the line's thumbnail. */
  images?: string[];
  /** Pesos; converted to centavos here. */
  amount: number;
  quantity: number;
}

export interface CheckoutSessionPayment {
  id: string;
  /** Pesos. */
  amount: number;
  /** PayMongo payment method type, e.g. "gcash", "card". */
  methodType: string;
}

export interface CheckoutSession {
  id: string;
  checkoutUrl: string;
  /** "active" or "expired". */
  status: string;
  /** The first paid payment, if the buyer has paid. */
  payment: CheckoutSessionPayment | null;
  metadata: Record<string, string>;
}

const toCentavos = (pesos: number) => Math.round(pesos * 100);

async function request(path: string, init: { method: 'GET' | 'POST'; body?: unknown }) {
  if (!PAYMONGO_SECRET_KEY) throw new PayMongoError('PAYMONGO_SECRET_KEY is not set');
  const response = await fetch(`${API_BASE}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${PAYMONGO_SECRET_KEY}:`).toString('base64')}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = (await response.json().catch(() => null)) as { data?: unknown; errors?: { detail?: string }[] } | null;
  if (!response.ok || !json?.data) {
    const detail = json?.errors?.map((error) => error.detail).filter(Boolean).join('; ');
    throw new PayMongoError(`PayMongo ${init.method} ${path} failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  return json.data;
}

type RawPayment = { id?: string; attributes?: { amount?: number; status?: string; source?: { type?: string } } };
type RawCheckoutSession = {
  id?: string;
  attributes?: {
    checkout_url?: string;
    status?: string;
    payments?: RawPayment[];
    payment_method_used?: string | null;
    metadata?: Record<string, string> | null;
  };
};

/** Maps a checkout_session resource (from the API or a webhook event) to our shape. */
export function parseCheckoutSession(raw: unknown): CheckoutSession {
  const session = (raw ?? {}) as RawCheckoutSession;
  const attributes = session.attributes ?? {};
  const paid = (attributes.payments ?? []).find((payment) => payment.attributes?.status === 'paid');
  return {
    id: session.id ?? '',
    checkoutUrl: attributes.checkout_url ?? '',
    status: attributes.status ?? '',
    payment: paid?.id
      ? {
          id: paid.id,
          amount: (paid.attributes?.amount ?? 0) / 100,
          methodType: paid.attributes?.source?.type ?? attributes.payment_method_used ?? '',
        }
      : null,
    metadata: attributes.metadata ?? {},
  };
}

export async function createCheckoutSession(params: {
  lineItems: CheckoutLineItem[];
  /** Pesos; the line items must add up to exactly this. */
  total: number;
  referenceNumber: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  billing: { name: string; phone: string };
  metadata: Record<string, string>;
}): Promise<CheckoutSession> {
  const lineItems = params.lineItems.map((item) => ({
    name: item.name,
    ...(item.description ? { description: item.description } : {}),
    ...(item.images?.length ? { images: item.images } : {}),
    quantity: item.quantity,
    amount: toCentavos(item.amount),
    currency: 'PHP',
  }));
  const sum = lineItems.reduce((total, item) => total + item.amount * item.quantity, 0);
  if (sum !== toCentavos(params.total)) {
    throw new PayMongoError(`Line items add up to ${sum} centavos, expected ${toCentavos(params.total)}`);
  }

  const data = await request('/checkout_sessions', {
    method: 'POST',
    body: {
      data: {
        attributes: {
          line_items: lineItems,
          payment_method_types: PAYMONGO_PAYMENT_METHODS,
          reference_number: params.referenceNumber,
          description: params.description,
          success_url: params.successUrl,
          cancel_url: params.cancelUrl,
          billing: params.billing,
          send_email_receipt: false,
          show_description: true,
          show_line_items: true,
          metadata: params.metadata,
        },
      },
    },
  });
  return parseCheckoutSession(data);
}

export async function retrieveCheckoutSession(id: string): Promise<CheckoutSession> {
  return parseCheckoutSession(await request(`/checkout_sessions/${encodeURIComponent(id)}`, { method: 'GET' }));
}

/**
 * Checks the `Paymongo-Signature` header (`t=<unix>,te=<test sig>,li=<live sig>`): an HMAC-SHA256
 * of `<t>.<raw body>` keyed with this environment's webhook secret. The timestamp's age is not
 * checked: PayMongo retries failed deliveries (up to 12 times, plus manual retries that re-send the
 * original event), and replaying a genuine "paid" event is harmless — completing a checkout is
 * idempotent.
 */
export function verifyWebhookSignature(rawBody: Buffer, header: string | undefined, livemode: boolean): boolean {
  if (!PAYMONGO_WEBHOOK_SECRET || !header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const [key, ...rest] = part.trim().split('=');
      return [key, rest.join('=')];
    })
  );
  const timestamp = Number(parts.t);
  const signature = livemode ? parts.li : parts.te;
  if (!Number.isFinite(timestamp) || !signature) return false;

  const expected = createHmac('sha256', PAYMONGO_WEBHOOK_SECRET).update(`${parts.t}.`).update(rawBody).digest('hex');
  const given = Buffer.from(signature, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** Payment method name stored on the order — matches the portal's payment_methods list. */
export function paymentMethodLabel(methodType: string): string {
  switch (methodType) {
    case 'gcash':
      return 'GCash';
    case 'paymaya':
      return 'Maya';
    case 'card':
      return 'Card';
    case 'grab_pay':
      return 'GrabPay';
    case 'qrph':
      return 'QR Ph';
    default:
      return /^(dob|brankas)/.test(methodType) ? 'Online banking' : 'PayMongo';
  }
}
