export interface SelectedOption {
  optionId: string;
  optionName: string;
  value: string;
}

export interface OrderItemPricing {
  pricingType: string;
  pricingEntryId: string;
  unitPrice: number;
  unit: string;
  width?: number;
  height?: number;
  packageName?: string;
  size?: { width: number; height: number; unit: string };
}

export interface StickerQuotation {
  package: string | null;
  width?: number;
  height?: number;
  unit?: string;
  quantity?: number;
  free?: number;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  productCategory: string;
  selectedOptions: SelectedOption[];
  quantity: number;
  notes: string;
  pricing: OrderItemPricing;
  lineTotal: number;
  stickerQuotationPackage?: string | null;
  stickerQuotationResult?: unknown;
  stickerQuotation?: StickerQuotation | null;
}

export interface ShippingAddress {
  name: string;
  phone: string;
  address: string;
  fee: number;
}

export interface Payment {
  status: string;
  method: string | null;
  downPayment: number;
  balance: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  status: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  notes: string;
  description: string;
  channel: string;
  additionalFees: number;
  layoutFee: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  createdByName: string;
  statusUpdatedBy: string | null;
  statusUpdatedByName: string;
  statusUpdatedAt: string | null;
  shippingAddress: ShippingAddress | null;
  payment: Payment;
}

export type OrderItemInput = Partial<Omit<OrderItem, 'pricing'>> & {
  pricing?: Partial<OrderItemPricing>;
};

export type OrderInput = Partial<
  Omit<
    Order,
    | 'id'
    | 'orderNumber'
    | 'createdAt'
    | 'updatedAt'
    | 'items'
    | 'createdBy'
    | 'createdByName'
    | 'statusUpdatedBy'
    | 'statusUpdatedByName'
    | 'statusUpdatedAt'
  >
> & {
  items?: OrderItemInput[];
};

// Fields only an admin/superadmin may set on update (enforced in the route layer,
// not here) — never accepted on create, and never includes the *Name fields since
// those are always resolved live from `users`, never stored as a snapshot.
export type OrderAdminEditableFields = {
  createdAt?: string;
  createdBy?: string | null;
  statusUpdatedAt?: string | null;
  statusUpdatedBy?: string | null;
};

export type OrderUpdateInput = OrderInput & OrderAdminEditableFields;

// One customer aggregated across orders within the ranking window (see `top_customers` in
// supabase/migrations/) — powers the order form's customer combobox suggestions, top-5 badge,
// and auto-fill of Phone + shipping fields from the customer's most recent order.
export interface CustomerRanking {
  customerName: string;
  customerPhone: string;
  shippingAddress: ShippingAddress | null;
  totalSpent: number;
  orderCount: number;
}
