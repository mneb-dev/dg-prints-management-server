import { supabase } from '../config/supabaseClient.js';
import {
  paymentMethodLabel,
  retrieveCheckoutSession,
  retrievePaymentIntent,
  type CheckoutSessionPayment,
} from '../utils/paymongo.js';

// Shop carts waiting for online payment. The order itself is only created (as paid) by the
// complete_shop_checkout RPC once PayMongo confirms the payment.

/** failed = the buyer cancelled or the payment was declined (Payment Intent checkouts). */
export type ShopCheckoutStatus = 'pending' | 'paid' | 'expired' | 'failed';

export interface ShopCheckout {
  id: string;
  total: number;
  status: ShopCheckoutStatus;
  /** Older checkouts: PayMongo's hosted Checkout Session. */
  paymongoCheckoutSessionId: string | null;
  /** Current checkouts: a Payment Intent for the method the buyer picked. */
  paymongoPaymentIntentId: string | null;
  /** Where the buyer pays: the hosted page (sessions) or the GCash/Maya page (intents). */
  checkoutUrl: string | null;
  orderId: string | null;
  orderNumber: string | null;
  paymentMethod: string | null;
  amountPaid: number | null;
  customerName: string;
  customerPhone: string;
  /** e.g. ["Tarpaulin ×3", "Sticker"] */
  items: string[];
  createdAt: string;
  paidAt: string | null;
}

interface ShopCheckoutRow {
  id: string;
  total: number | string;
  status: ShopCheckoutStatus;
  paymongo_checkout_session_id: string | null;
  paymongo_payment_intent_id: string | null;
  checkout_url: string | null;
  order_id: string | null;
  payment_method: string | null;
  amount_paid: number | string | null;
  customer_name: string | null;
  customer_phone: string | null;
  items: { product_name?: string; quantity?: number }[] | null;
  created_at: string;
  paid_at: string | null;
  order: { order_number: string } | null;
}

const SELECT =
  'id, total, status, paymongo_checkout_session_id, paymongo_payment_intent_id, checkout_url, order_id, ' +
  'payment_method, amount_paid, ' +
  'customer_name, customer_phone:order_payload->>customer_phone, items:order_payload->items, created_at, paid_at, ' +
  'order:orders(order_number)';

function mapRow(row: ShopCheckoutRow): ShopCheckout {
  return {
    id: row.id,
    total: Number(row.total),
    status: row.status,
    paymongoCheckoutSessionId: row.paymongo_checkout_session_id,
    paymongoPaymentIntentId: row.paymongo_payment_intent_id,
    checkoutUrl: row.checkout_url,
    orderId: row.order_id,
    orderNumber: row.order?.order_number ?? null,
    paymentMethod: row.payment_method,
    amountPaid: row.amount_paid === null ? null : Number(row.amount_paid),
    customerName: row.customer_name ?? '',
    customerPhone: row.customer_phone ?? '',
    items: (row.items ?? []).map(
      (item) => `${item.product_name ?? 'Item'}${(item.quantity ?? 1) > 1 ? ` ×${item.quantity}` : ''}`
    ),
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

/** `orderPayload` is the frozen `upsert_order` payload (see `toRpcPayload`). */
export async function createShopCheckout(id: string, orderPayload: unknown, total: number): Promise<void> {
  const { error } = await supabase.from('shop_checkouts').insert({ id, order_payload: orderPayload, total });
  if (error) throw new Error(error.message);
}

export async function attachCheckoutSession(id: string, sessionId: string, checkoutUrl: string): Promise<void> {
  const { error } = await supabase
    .from('shop_checkouts')
    .update({ paymongo_checkout_session_id: sessionId, checkout_url: checkoutUrl })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function attachPaymentIntent(id: string, intentId: string, paymentUrl: string): Promise<void> {
  const { error } = await supabase
    .from('shop_checkouts')
    .update({ paymongo_payment_intent_id: intentId, checkout_url: paymentUrl })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function getShopCheckout(id: string): Promise<ShopCheckout | undefined> {
  const { data, error } = await supabase.from('shop_checkouts').select(SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as unknown as ShopCheckoutRow) : undefined;
}

export async function findShopCheckoutBySession(sessionId: string): Promise<ShopCheckout | undefined> {
  const { data, error } = await supabase
    .from('shop_checkouts')
    .select(SELECT)
    .eq('paymongo_checkout_session_id', sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as unknown as ShopCheckoutRow) : undefined;
}

export async function findShopCheckoutByIntent(intentId: string): Promise<ShopCheckout | undefined> {
  const { data, error } = await supabase
    .from('shop_checkouts')
    .select(SELECT)
    .eq('paymongo_payment_intent_id', intentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as unknown as ShopCheckoutRow) : undefined;
}

/**
 * Newest first. `search` matches the buyer's name, or — when it has 4+ digits — their phone number
 * in any format ("0917 123 4567", "+63 917…" and "9171234567" all match).
 */
export async function listShopCheckouts(search: string, limit: number): Promise<ShopCheckout[]> {
  let query = supabase.from('shop_checkouts').select(SELECT).order('created_at', { ascending: false }).limit(limit);
  const term = search.trim();
  const digits = term.replace(/\D/g, '').replace(/^(63|0)/, '');
  if (digits.length >= 4) {
    query = query.like('customer_phone_digits', `%${digits}%`);
  } else if (term) {
    query = query.ilike('customer_name', `%${term.replace(/[%_\\]/g, '\\$&')}%`);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as unknown as ShopCheckoutRow[]).map(mapRow);
}

/** Only a still-pending checkout is expired; a paid one is left alone. */
export async function expireShopCheckout(id: string): Promise<void> {
  const { error } = await supabase.from('shop_checkouts').update({ status: 'expired' }).eq('id', id).eq('status', 'pending');
  if (error) throw new Error(error.message);
}

/** The buyer cancelled or the payment was declined. Only a pending checkout changes. */
export async function failShopCheckout(id: string): Promise<void> {
  const { error } = await supabase.from('shop_checkouts').update({ status: 'failed' }).eq('id', id).eq('status', 'pending');
  if (error) throw new Error(error.message);
}

/** Creates the paid order (once — repeat calls return the same order id). */
async function completeShopCheckout(
  id: string,
  payment: { paymentId: string; method: string; amount: number }
): Promise<string> {
  const { data, error } = await supabase.rpc('complete_shop_checkout', {
    p_checkout_id: id,
    p_payment_id: payment.paymentId,
    p_method: payment.method,
    p_amount: payment.amount,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Creates the paid order for a confirmed PayMongo payment; returns the order id, or null if unpaid. */
export async function settleShopCheckout(
  checkout: ShopCheckout,
  payment: CheckoutSessionPayment | null
): Promise<string | null> {
  if (checkout.status === 'paid') return checkout.orderId;
  if (!payment) return null;
  return completeShopCheckout(checkout.id, {
    paymentId: payment.id,
    method: paymentMethodLabel(payment.methodType),
    amount: payment.amount,
  });
}

/**
 * Asks PayMongo where a not-yet-paid checkout stands and acts on it: creates the paid order if the
 * money is there; otherwise marks it failed (intent back to awaiting a payment method: cancelled or
 * declined) or expired (session expired). Returns the fresh checkout. Used by the shop's return page
 * and the portal's "Check payment" (also for checkouts already marked expired/failed — a payment
 * can still land after we gave up).
 */
export async function recheckShopCheckout(checkout: ShopCheckout): Promise<ShopCheckout> {
  if (checkout.status === 'paid') return checkout;
  if (checkout.paymongoPaymentIntentId) {
    const intent = await retrievePaymentIntent(checkout.paymongoPaymentIntentId);
    const orderId = await settleShopCheckout(checkout, intent.payment);
    if (!orderId && intent.status === 'awaiting_payment_method') await failShopCheckout(checkout.id);
  } else if (checkout.paymongoCheckoutSessionId) {
    const session = await retrieveCheckoutSession(checkout.paymongoCheckoutSessionId);
    const orderId = await settleShopCheckout(checkout, session.payment);
    if (!orderId && session.status === 'expired') await expireShopCheckout(checkout.id);
  } else {
    return checkout;
  }
  return (await getShopCheckout(checkout.id)) ?? checkout;
}
