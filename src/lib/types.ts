export type SessionStatus = 'ACTIVE' | 'LOCKED';

export type Session = {
  id: string;
  receipt_name: string;
  status: SessionStatus;
  currency: string;
  tax_total: number;
  tip_total: number;
  fees_total: number;
  equal_split_paid_by: Record<string, string>;
  created_at: string;
  updated_at: string;
  locked_at: string | null;
  locked_by: string | null;
};

export type Person = {
  id: string;
  session_id: string;
  display_name: string;
  created_at: string;
  updated_at: string;
};

export type Group = {
  id: string;
  session_id: string;
  name: string;
  order: number;
  created_at: string;
  updated_at: string;
};

export type Item = {
  id: string;
  session_id: string;
  group_id: string | null;
  label: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  is_exploded: boolean;
  parent_item_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ReceiptImage = {
  id: string;
  session_id: string;
  image_url: string;
  width: number;
  height: number;
  created_at: string;
};

export type Allocation = {
  id: string;
  session_id: string;
  item_id: string;
  person_id: string;
  shares: number;
  created_at: string;
  updated_at: string;
};

export type ChangeType = 'INSERT' | 'UPDATE' | 'DELETE';

export type Change<T> = {
  type: ChangeType;
  record: T;
};

export type SubscriptionHandlers = {
  onSession?: (change: Change<Session>) => void;
  onPerson?: (change: Change<Person>) => void;
  onGroup?: (change: Change<Group>) => void;
  onItem?: (change: Change<Item>) => void;
  onReceipt?: (change: Change<ReceiptImage>) => void;
  onAllocation?: (change: Change<Allocation>) => void;
};
