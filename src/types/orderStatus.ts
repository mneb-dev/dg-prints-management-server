export interface OrderStatus {
  id: string;
  name: string;
  label: string;
  icon: string;
  color: string;
  protected: boolean;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderStatusInput {
  name?: string;
  label?: string;
  icon?: string;
  color?: string;
  enabled?: boolean;
}
