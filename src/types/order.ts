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
  createdAt: string;
  updatedAt: string;
  shippingAddress: ShippingAddress | null;
  payment: Payment;
}

export type OrderItemInput = Partial<Omit<OrderItem, 'pricing'>> & {
  pricing?: Partial<OrderItemPricing>;
};

export type OrderInput = Partial<
  Omit<Order, 'id' | 'orderNumber' | 'createdAt' | 'updatedAt' | 'items'>
> & {
  items?: OrderItemInput[];
};
