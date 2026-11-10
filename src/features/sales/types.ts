import type { Material, RetailProduct } from "@/features/inventory/types";
import type { Recipe } from "@/features/recipes/types";

export type PaymentMethod = "cash" | "transfer" | "card" | "other";
export type PosItemKind = "retail_product" | "recipe";
export type PosCategory = "original" | "1.1" | "replica";

export interface PaymentMethodOption {
  method: PaymentMethod;
  label: string;
  enabled: boolean;
}

export interface SaleCartLine {
  key: string;
  kind: PosItemKind;
  id: string;
  quantity: number;
  fill_consumption_ml: number | null;
}

export interface SaleCustomer {
  id: string;
  full_name: string;
  phone: string | null;
}

export interface SaleItemRecord {
  id: string;
  sale_id: string;
  item_type: PosItemKind;
  retail_product_id: string | null;
  recipe_id: string | null;
  item_name_snapshot: string;
  product_type_snapshot: "original" | "1.1" | null;
  size_ml_snapshot: number | null;
  recipe_version_snapshot: number | null;
  quantity: number;
  unit_price_cop: number;
  line_total_cop: number;
  created_at: string;
}

export interface SaleAdjustmentRecord {
  id: string;
  operation: "void" | "refund";
  reason: string;
  amount_cop: number;
  inventory_restored: boolean;
  refund_payment_method: PaymentMethod | null;
  created_at: string;
}

export interface SaleRecord {
  id: string;
  sale_number: number;
  created_by: string;
  customer_id: string | null;
  cash_session_id: string | null;
  status: "completed" | "voided";
  payment_method: PaymentMethod;
  subtotal_cop: number;
  discount_cop: number;
  total_cop: number;
  notes: string | null;
  created_at: string;
  customer: SaleCustomer | null;
  items: SaleItemRecord[];
  adjustment: SaleAdjustmentRecord | null;
}

export type PosSelection =
  | { kind: "product"; product: RetailProduct }
  | { kind: "recipe"; recipe: Recipe };

export interface PosInventoryState {
  products: RetailProduct[];
  materials: Material[];
}
