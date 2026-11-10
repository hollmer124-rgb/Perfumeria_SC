import { supabase } from "@/lib/supabase";
import type {
  InventoryCost,
  InventoryMovement,
  Material,
  Perfume,
  Purchase,
  RetailProduct,
  Supplier,
} from "@/features/inventory/types";

export const inventoryQueryKeys = {
  products: ["retail-products"] as const,
  materials: ["materials"] as const,
  perfumes: ["perfumes"] as const,
  suppliers: ["suppliers"] as const,
  costs: ["inventory-costs"] as const,
  movements: ["inventory-movements"] as const,
  purchases: ["purchases"] as const,
};

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase no está conectado. Revisa la configuración e inténtalo de nuevo.");
  }
  return supabase;
}

export async function fetchProducts(): Promise<RetailProduct[]> {
  const { data, error } = await requireSupabase()
    .from("retail_products")
    .select(
      "id, perfume_id, product_type, sku, name, brand, size_ml, price_cop, stock_qty, minimum_qty, supplier_id, active, created_at",
    )
    .order("name");
  if (error) throw error;
  return (data ?? []) as RetailProduct[];
}

export async function fetchMaterials(): Promise<Material[]> {
  const { data, error } = await requireSupabase()
    .from("materials")
    .select(
      "id, name, base_unit, on_hand_qty, minimum_qty, category, perfume_id, supplier_id, size_ml, active, created_at",
    )
    .order("name");
  if (error) throw error;
  return (data ?? []) as Material[];
}

export async function fetchPerfumes(): Promise<Perfume[]> {
  const { data, error } = await requireSupabase()
    .from("perfumes")
    .select("id, name, brand, active")
    .order("brand")
    .order("name");
  if (error) throw error;
  return (data ?? []) as Perfume[];
}

export async function fetchSuppliers(): Promise<Supplier[]> {
  const { data, error } = await requireSupabase()
    .from("suppliers")
    .select("id, name, tax_id, contact_name, phone, email, notes, active, created_at")
    .order("name");
  if (error) throw error;
  return (data ?? []) as Supplier[];
}

export async function fetchInventoryCosts(): Promise<InventoryCost[]> {
  const { data, error } = await requireSupabase().rpc("admin_inventory_costs");
  if (error) throw error;
  return (data ?? []) as InventoryCost[];
}

export async function fetchInventoryMovements(): Promise<InventoryMovement[]> {
  const { data, error } = await requireSupabase()
    .from("inventory_movements")
    .select(
      "id, material_id, retail_product_id, movement_type, sale_item_id, purchase_item_id, quantity_delta, reason, created_by, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as InventoryMovement[];
}

export async function fetchPurchases(): Promise<Purchase[]> {
  const { data, error } = await requireSupabase()
    .from("purchases")
    .select(
      "id, supplier_id, created_by, status, purchased_at, received_at, total_cop, notes, created_at, suppliers(name), purchase_items(id, item_name_snapshot, unit_snapshot, quantity, unit_cost_cop, line_total_cop)",
    )
    .order("purchased_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((purchase) => ({
    ...purchase,
    suppliers: Array.isArray(purchase.suppliers)
      ? purchase.suppliers[0] ?? null
      : purchase.suppliers,
  })) as Purchase[];
}

export function getInventoryItemName(
  movement: InventoryMovement,
  products: RetailProduct[],
  materials: Material[],
): string {
  if (movement.material_id) {
    return (
      materials.find((item) => item.id === movement.material_id)?.name ??
      "Material no disponible"
    );
  }
  return (
    products.find((item) => item.id === movement.retail_product_id)?.name ??
    "Producto no disponible"
  );
}

export function movementLabel(
  type: InventoryMovement["movement_type"],
): string {
  const labels: Record<InventoryMovement["movement_type"], string> = {
    purchase: "Compra",
    sale: "Venta / consumo",
    adjustment_in: "Ajuste de entrada",
    adjustment_out: "Ajuste de salida",
    reversal: "Reversión",
  };
  return labels[type];
}
