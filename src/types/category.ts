export interface CommonSize {
  width: number;
  height: number;
  unit: string;
}

export interface Category {
  id: string;
  name: string;
  active: boolean;
  statusFlow: string[];
  commonSizes: CommonSize[];
  createdAt: string;
  updatedAt: string;
}

export type CategoryInput = Partial<Omit<Category, 'id' | 'createdAt' | 'updatedAt'>>;

export interface HotSizes {
  stickerLabel: CommonSize[];
  tarpaulin: CommonSize[];
}
