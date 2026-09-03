export interface ProductOption {
  id: string;
  name: string;
  required: boolean;
  values: string[];
}

export interface AppliesToCondition {
  optionId: string;
  value: string;
}

export interface ProductPricing {
  id: string;
  appliesTo: 'All' | AppliesToCondition[];
  pricingType: string;
  packageName?: string;
  price: number;
  unit: string;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  description: string;
  status: string;
  options: ProductOption[];
  pricing: ProductPricing[];
  createdAt: string;
  updatedAt: string;
}

export type ProductInput = Partial<
  Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'options' | 'pricing'>
> & {
  options?: Array<Partial<ProductOption>>;
  pricing?: Array<Partial<ProductPricing>>;
};
