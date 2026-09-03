export interface Category {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CategoryInput = Partial<Omit<Category, 'id' | 'createdAt' | 'updatedAt'>>;
