export type RetailProductType = "original" | "1.1";
export type MaterialUnit = "g" | "ml" | "unit" | "dose";
export type MaterialCategory =
  | "essence"
  | "alcohol"
  | "pheromone"
  | "bottle"
  | "other";
export type PurchaseStatus = "draft" | "received" | "cancelled";

export interface RetailProduct {
  id: string;
  perfume_id: string | null;
  product_type: RetailProductType;
  sku: string;
  name: string;
  brand: string;
  size_ml: number | null;
  price_cop: number;
  stock_qty: number;
  minimum_qty: number;
  supplier_id: string | null;
  active: boolean;
  created_at: string;
}

export interface Material {
  id: string;
  name: string;
  base_unit: MaterialUnit;
  on_hand_qty: number;
  minimum_qty: number;
  category: MaterialCategory;
  perfume_id: string | null;
  supplier_id: string | null;
  size_ml: number | null;
  active: boolean;
  created_at: string;
}

export interface Perfume {
  id: string;
  name: string;
  brand: string;
  active: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  tax_id: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

export interface InventoryCost {
  item_kind: "material" | "retail_product";
  item_id: string;
  item_name: string;
  quantity_on_hand: number;
  unit: string;
  avg_unit_cost_cop: number;
  inventory_value_cop: number;
}

export interface InventoryMovement {
  id: string;
  material_id: string | null;
  retail_product_id: string | null;
  movement_type: "purchase" | "sale" | "adjustment_in" | "adjustment_out" | "reversal";
  sale_item_id: string | null;
  purchase_item_id: string | null;
  quantity_delta: number;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PurchaseLine {
  id: string;
  item_name_snapshot: string;
  unit_snapshot: string;
  quantity: number;
  unit_cost_cop: number;
  line_total_cop: number;
}

export interface Purchase {
  id: string;
  supplier_id: string;
  created_by: string;
  status: PurchaseStatus;
  purchased_at: string;
  received_at: string | null;
  total_cop: number;
  notes: string | null;
  created_at: string;
  purchase_items: PurchaseLine[];
  suppliers: { name: string } | null;
}
