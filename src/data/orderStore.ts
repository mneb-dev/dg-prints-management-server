import { randomUUID } from 'node:crypto';

import { supabase } from '../config/supabaseClient.js';
import { getUser } from './userStore.js';
import type {
  Order,
  OrderInput,
  OrderItem,
  OrderItemInput,
  OrderItemPricing,
  OrderUpdateInput,
  Payment,
  ShippingAddress,
  StickerQuotation,
} from '../types/order.js';

interface OrderItemRow {
  id: string;
  product_id: string;
  product_name: string;
  product_category: string;
  selected_options: unknown;
  quantity: number;
  notes: string;
  pricing: unknown;
  line_total: number | string;
  sticker_quotation: Record<string, unknown> | null;
  sort_order: number;
}

interface OrderRow {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  status: string;
  subtotal: number | string;
  discount: number | string;
  total: number | string;
  notes: string;
  description: string;
  channel: string;
  additional_fees: number | string;
  layout_fee: number | string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  // Present (joined/computed) on list_orders' RPC rows; absent on getOrder's
  // plain-column select — getOrder resolves the name itself after fetching.
  created_by_name?: string;
  status_updated_by: string | null;
  status_updated_by_name?: string;
  status_updated_at: string | null;
  shipping_address: Record<string, unknown> | null;
  payment_status: string;
  payment_method: string | null;
  payment_down_payment: number | string;
  payment_balance: number | string;
  items: OrderItemRow[];
}

const ORDER_SELECT = `
  id, order_number, customer_name, customer_phone, status,
  subtotal, discount, total, notes, description, channel, additional_fees, layout_fee,
  created_at, updated_at, created_by, status_updated_by, status_updated_at,
  shipping_address,
  payment_status, payment_method, payment_down_payment, payment_balance,
  items:order_items ( id, product_id, product_name, product_category,
    selected_options, quantity, notes, pricing, line_total, sticker_quotation, sort_order )
`;

function foldStickerQuotation(
  item: OrderItemInput | OrderItem
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (item.stickerQuotationPackage !== undefined) {
    out.stickerQuotationPackage = item.stickerQuotationPackage;
  }
  if (item.stickerQuotationResult !== undefined) {
    out.stickerQuotationResult = item.stickerQuotationResult;
  }
  if (item.stickerQuotation !== undefined) {
    out.stickerQuotation = item.stickerQuotation;
  }
  return Object.keys(out).length ? out : null;
}

function unfoldStickerQuotation(value: Record<string, unknown> | null) {
  return {
    stickerQuotationPackage: value?.stickerQuotationPackage as string | null | undefined,
    stickerQuotationResult: value?.stickerQuotationResult,
    stickerQuotation: value?.stickerQuotation as StickerQuotation | null | undefined,
  };
}

function mapRowToOrder(row: OrderRow): Order {
  const items = [...row.items]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.product_name,
      productCategory: item.product_category,
      selectedOptions: (item.selected_options ?? []) as OrderItem['selectedOptions'],
      quantity: item.quantity,
      notes: item.notes,
      pricing: (item.pricing ?? {}) as OrderItemPricing,
      lineTotal: Number(item.line_total),
      ...unfoldStickerQuotation(item.sticker_quotation),
    }));

  return {
    id: row.id,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    status: row.status,
    items,
    subtotal: Number(row.subtotal),
    discount: Number(row.discount),
    total: Number(row.total),
    notes: row.notes,
    description: row.description,
    channel: row.channel,
    additionalFees: Number(row.additional_fees),
    layoutFee: Number(row.layout_fee),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? '',
    statusUpdatedBy: row.status_updated_by,
    statusUpdatedByName: row.status_updated_by_name ?? '',
    statusUpdatedAt: row.status_updated_at,
    shippingAddress: row.shipping_address as ShippingAddress | null,
    payment: {
      status: row.payment_status,
      method: row.payment_method,
      downPayment: Number(row.payment_down_payment),
      balance: Number(row.payment_balance),
    },
  };
}

function toRpcPayload(order: Order) {
  return {
    id: order.id,
    customer_name: order.customerName,
    customer_phone: order.customerPhone,
    status: order.status,
    subtotal: order.subtotal,
    discount: order.discount,
    total: order.total,
    notes: order.notes,
    description: order.description,
    channel: order.channel,
    additional_fees: order.additionalFees,
    layout_fee: order.layoutFee,
    created_at: order.createdAt,
    created_by: order.createdBy,
    status_updated_by: order.statusUpdatedBy,
    status_updated_at: order.statusUpdatedAt,
    shipping_address: order.shippingAddress ?? null,
    payment_status: order.payment.status,
    payment_method: order.payment.method,
    payment_down_payment: order.payment.downPayment,
    payment_balance: order.payment.balance,
    items: order.items.map((item, index) => ({
      id: item.id,
      product_id: item.productId,
      product_name: item.productName,
      product_category: item.productCategory,
      selected_options: item.selectedOptions,
      quantity: item.quantity,
      notes: item.notes,
      pricing: item.pricing,
      line_total: item.lineTotal,
      sticker_quotation: foldStickerQuotation(item),
      sort_order: index,
    })),
  };
}

function normalizeItems(
  items: OrderItemInput[] | undefined,
  forceNewIds = false
): OrderItem[] {
  return (items ?? []).map((item) => ({
    id: forceNewIds ? randomUUID() : item.id ?? randomUUID(),
    productId: item.productId ?? '',
    productName: item.productName ?? '',
    productCategory: item.productCategory ?? '',
    selectedOptions: item.selectedOptions ?? [],
    quantity: item.quantity ?? 1,
    notes: item.notes ?? '',
    pricing: {
      pricingType: item.pricing?.pricingType ?? 'Per Unit',
      pricingEntryId: item.pricing?.pricingEntryId ?? '',
      unitPrice: item.pricing?.unitPrice ?? 0,
      unit: item.pricing?.unit ?? '',
      width: item.pricing?.width,
      height: item.pricing?.height,
      packageName: item.pricing?.packageName,
      size: item.pricing?.size,
    },
    lineTotal: item.lineTotal ?? 0,
    stickerQuotationPackage: item.stickerQuotationPackage,
    stickerQuotationResult: item.stickerQuotationResult,
    stickerQuotation: item.stickerQuotation,
  }));
}

export interface ListOrdersParams {
  page: number;
  pageSize: number;
  search?: string;
  category?: string;
  status?: string;
  paymentStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

export interface ListOrdersResult {
  items: Order[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listOrders(params: ListOrdersParams): Promise<ListOrdersResult> {
  const { page, pageSize, search, category, status, paymentStatus, dateFrom, dateTo, sortBy, sortDir } = params;
  const { data, error } = await supabase.rpc('list_orders', {
    p_search: search || null,
    p_category: category || null,
    p_status: status || null,
    p_payment_status: paymentStatus || null,
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
    p_sort_by: sortBy,
    p_sort_dir: sortDir,
  });
  if (error) throw new Error(error.message);
  const payload = data as unknown as { rows: OrderRow[]; total: number };
  return {
    items: payload.rows.map(mapRowToOrder),
    total: payload.total,
    page,
    pageSize,
  };
}

export async function getOrder(id: string): Promise<Order | undefined> {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return undefined;

  const order = mapRowToOrder(data as unknown as OrderRow);
  const [createdByName, statusUpdatedByName] = await Promise.all([
    order.createdBy ? resolveActorName(order.createdBy) : Promise.resolve(''),
    order.statusUpdatedBy ? resolveActorName(order.statusUpdatedBy) : Promise.resolve(''),
  ]);
  return { ...order, createdByName, statusUpdatedByName };
}

async function resolveActorName(actorId: string): Promise<string> {
  const user = await getUser(actorId);
  return user ? `${user.firstName} ${user.lastName}`.trim() : '';
}

export async function createOrder(input: OrderInput, actorId: string): Promise<Order> {
  const now = new Date().toISOString();
  const payment: Payment = {
    status: input.payment?.status ?? 'unpaid',
    method: input.payment?.method ?? null,
    downPayment: input.payment?.downPayment ?? 0,
    balance: input.payment?.balance ?? 0,
  };

  const order: Order = {
    id: randomUUID(),
    orderNumber: '',
    customerName: input.customerName ?? '',
    customerPhone: input.customerPhone ?? '',
    status: input.status ?? 'pending',
    items: normalizeItems(input.items, true),
    subtotal: input.subtotal ?? 0,
    discount: input.discount ?? 0,
    total: input.total ?? 0,
    notes: input.notes ?? '',
    description: input.description ?? '',
    channel: input.channel ?? '',
    additionalFees: input.additionalFees ?? 0,
    layoutFee: input.layoutFee ?? 0,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
    createdByName: '',
    statusUpdatedBy: actorId,
    statusUpdatedByName: '',
    statusUpdatedAt: now,
    shippingAddress: input.shippingAddress ?? null,
    payment,
  };

  const { error } = await supabase.rpc('upsert_order', { payload: toRpcPayload(order) });
  if (error) throw new Error(error.message);

  const created = await getOrder(order.id);
  if (!created) throw new Error('Failed to load created order');
  return created;
}

export async function updateOrder(
  id: string,
  input: OrderUpdateInput,
  actorId: string
): Promise<Order | undefined> {
  const existing = await getOrder(id);
  if (!existing) return undefined;

  const statusChanged = input.status !== undefined && input.status !== existing.status;
  const now = new Date().toISOString();

  const updated: Order = {
    ...existing,
    ...input,
    items: input.items ? normalizeItems(input.items) : existing.items,
    payment: input.payment
      ? {
          status: input.payment.status ?? existing.payment.status,
          method: input.payment.method ?? existing.payment.method,
          downPayment: input.payment.downPayment ?? existing.payment.downPayment,
          balance: input.payment.balance ?? existing.payment.balance,
        }
      : existing.payment,
    id: existing.id,
    orderNumber: existing.orderNumber,
    updatedAt: now,
    createdAt: input.createdAt ?? existing.createdAt,
    createdBy: input.createdBy !== undefined ? input.createdBy : existing.createdBy,
    statusUpdatedBy:
      input.statusUpdatedBy !== undefined
        ? input.statusUpdatedBy
        : statusChanged
          ? actorId
          : existing.statusUpdatedBy,
    statusUpdatedAt:
      input.statusUpdatedAt !== undefined
        ? input.statusUpdatedAt
        : statusChanged
          ? now
          : existing.statusUpdatedAt,
  };

  const { error } = await supabase.rpc('upsert_order', { payload: toRpcPayload(updated) });
  if (error) throw new Error(error.message);

  const result = await getOrder(id);
  if (!result) throw new Error('Failed to load updated order');
  return result;
}

export async function deleteOrder(id: string): Promise<boolean> {
  const { data, error } = await supabase.from('orders').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}
