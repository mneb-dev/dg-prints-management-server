import { createHmac, timingSafeEqual } from 'node:crypto';

import { PAYMONGO_SECRET_KEY, PAYMONGO_WEBHOOK_SECRET } from '../config/env.js';

// Thin client for the bits of PayMongo's API the online shop uses. New checkouts use Payment
// Intents (our checkout lists the methods; the buyer goes straight to GCash/Maya); Checkout
// Sessions (PayMongo's hosted page) remain only so older pending checkouts can still settle.
// Docs: https://docs.paymongo.com/docs/payment-acceptance-key-concepts

const API_BASE = 'https://api.paymongo.com/v1';

export class PayMongoError extends Error {}

/** A payment method the shop offers, in display order (the first is preselected). */
export interface ShopPaymentMethod {
  /** PayMongo payment method type, e.g. "gcash", "paymaya". */
  type: string;
  label: string;
}

/**
 * Payment method types the shop's direct-to-wallet flow supports: ones where attaching the method
 * returns a page to send the buyer to. (Cards and QR Ph need extra screens on our checkout.) Which of
 * these the checkout actually lists is `app_settings.shop_payment_methods` (portal Settings).
 */
export const SUPPORTED_SHOP_PAYMENT_METHODS = ['gcash', 'paymaya'] as const;

/** The shop's list, in the order saved in Settings (the first is preselected). */
export function toShopPaymentMethods(types: string[]): ShopPaymentMethod[] {
  return types
    .filter((type) => (SUPPORTED_SHOP_PAYMENT_METHODS as readonly string[]).includes(type))
    .map((type) => ({ type, label: paymentMethodLabel(type) }));
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

async function request(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<unknown> {
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

export async function retrieveCheckoutSession(id: string): Promise<CheckoutSession> {
  return parseCheckoutSession(await request(`/checkout_sessions/${encodeURIComponent(id)}`, { method: 'GET' }));
}

// ---------- Payment Intents ----------

export interface PaymentIntent {
  id: string;
  /** awaiting_payment_method | awaiting_next_action | processing | succeeded */
  status: string;
  /** Where to send the buyer to authorize (GCash/Maya page), after a method is attached. */
  redirectUrl: string;
  /** The first paid payment, once the buyer has paid. */
  payment: CheckoutSessionPayment | null;
}

type RawPaymentIntent = {
  id?: string;
  attributes?: {
    status?: string;
    payments?: RawPayment[];
    next_action?: { redirect?: { url?: string } } | null;
  };
};

function parsePaymentIntent(raw: unknown): PaymentIntent {
  const intent = (raw ?? {}) as RawPaymentIntent;
  const attributes = intent.attributes ?? {};
  const paid = (attributes.payments ?? []).find((payment) => payment.attributes?.status === 'paid');
  return {
    id: intent.id ?? '',
    status: attributes.status ?? '',
    redirectUrl: attributes.next_action?.redirect?.url ?? '',
    payment: paid?.id
      ? { id: paid.id, amount: (paid.attributes?.amount ?? 0) / 100, methodType: paid.attributes?.source?.type ?? '' }
      : null,
  };
}

/** A `payment` resource, as sent in `payment.paid` / `payment.failed` webhook events. */
export interface PaymentEventData {
  id: string;
  status: string;
  /** Pesos. */
  amount: number;
  methodType: string;
  paymentIntentId: string;
}

export function parsePaymentEvent(raw: unknown): PaymentEventData {
  const payment = (raw ?? {}) as {
    id?: string;
    attributes?: { status?: string; amount?: number; source?: { type?: string }; payment_intent_id?: string | null };
  };
  const attributes = payment.attributes ?? {};
  return {
    id: payment.id ?? '',
    status: attributes.status ?? '',
    amount: (attributes.amount ?? 0) / 100,
    methodType: attributes.source?.type ?? '',
    paymentIntentId: attributes.payment_intent_id ?? '',
  };
}

/**
 * Starts an online payment for one method and returns where to send the buyer: creates a Payment
 * Intent for `amount`, a Payment Method of `methodType`, and attaches it. GCash/Maya send the buyer
 * back to `returnUrl` whether they pay or cancel. No billing details are sent: PayMongo then
 * requires an email, which the shop doesn't collect — the buyer's name goes in `description`.
 */
export async function startPayment(params: {
  /** Pesos. */
  amount: number;
  methodType: string;
  description: string;
  returnUrl: string;
  metadata: Record<string, string>;
}): Promise<PaymentIntent> {
  const intent = parsePaymentIntent(
    await request('/payment_intents', {
      method: 'POST',
      body: {
        data: {
          attributes: {
            amount: toCentavos(params.amount),
            currency: 'PHP',
            payment_method_allowed: [params.methodType],
            description: params.description,
            metadata: params.metadata,
          },
        },
      },
    })
  );
  const method = (await request('/payment_methods', {
    method: 'POST',
    body: { data: { attributes: { type: params.methodType } } },
  })) as { id?: string };
  if (!intent.id || !method.id) throw new PayMongoError('PayMongo returned no payment intent or method id');

  const attached = parsePaymentIntent(
    await request(`/payment_intents/${encodeURIComponent(intent.id)}/attach`, {
      method: 'POST',
      body: { data: { attributes: { payment_method: method.id, return_url: params.returnUrl } } },
    })
  );
  if (!attached.redirectUrl && attached.status !== 'succeeded') {
    throw new PayMongoError(`PayMongo gave no redirect for ${params.methodType} (status ${attached.status})`);
  }
  return attached;
}

export async function retrievePaymentIntent(id: string): Promise<PaymentIntent> {
  return parsePaymentIntent(await request(`/payment_intents/${encodeURIComponent(id)}`, { method: 'GET' }));
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
