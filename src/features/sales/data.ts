import { supabase } from "@/lib/supabase";
import type { RetailProduct } from "@/features/inventory/types";
import type { PaymentMethod, PaymentMethodOption, SaleRecord } from "@/features/sales/types";

export const salesQueryKeys = {
  products: ["retail-products"] as const,
  recipes: ["recipes"] as const,
  costs: ["inventory-costs"] as const,
  customers: ["sales-customers"] as const,
  paymentMethods: ["payment-method-settings"] as const,
  cashSessions: ["pos-open-cash-sessions"] as const,
  history: ["sales-history"] as const,
};

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase no está conectado. Revisa la configuración e inténtalo de nuevo.");
  }
  return supabase;
}

function normalizeOne<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function fetchPosProducts(): Promise<RetailProduct[]> {
  const { data, error } = await requireSupabase()
    .from("retail_products")
    .select(
      "id, perfume_id, product_type, sku, name, brand, size_ml, price_cop, stock_qty, minimum_qty, supplier_id, active, created_at",
    )
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return (data ?? []) as RetailProduct[];
}

export async function fetchPaymentMethods(): Promise<PaymentMethodOption[]> {
  const { data, error } = await requireSupabase()
    .from("payment_method_settings")
    .select("method, label, enabled")
    .order("label");
  if (error) throw error;
  return (data ?? []) as PaymentMethodOption[];
}

export async function fetchSalesCustomers(): Promise<
  Array<{ id: string; full_name: string; phone: string | null }>
> {
  const { data, error } = await requireSupabase()
    .from("customers")
    .select("id, full_name, phone")
    .order("full_name");
  if (error) throw error;
  return data ?? [];
}

export async function fetchPosCashSessions(userId: string): Promise<
  Array<{ id: string; opened_by: string }>
> {
  const { data, error } = await requireSupabase()
    .from("cash_sessions")
    .select("id, opened_by")
    .eq("status", "open")
    .eq("opened_by", userId)
    .order("opened_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createSalesCustomer(input: {
  full_name: string;
  phone: string;
  created_by: string;
}): Promise<string> {
  const { data, error } = await requireSupabase()
    .from("customers")
    .insert({
      full_name: input.full_name.trim(),
      phone: input.phone.trim() || null,
      created_by: input.created_by,
    })
    .select("id")
    .single();
  if (error) throw error;
  if (!data?.id) throw new Error("Supabase no confirmó el cliente creado.");
  return data.id as string;
}

export async function registerPosSale(input: {
  items: Array<{
    kind: "retail_product" | "recipe";
    id: string;
    quantity: number;
    fill_consumption_ml: number | null;
  }>;
  payment_method: PaymentMethod;
  idempotency_key: string;
  discount_cop: number;
  customer_id: string | null;
  cash_session_id: string | null;
  notes: string;
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc("register_pos_sale", {
    p_items: input.items,
    p_payment_method: input.payment_method,
    p_idempotency_key: input.idempotency_key,
    p_discount_cop: input.discount_cop,
    p_customer_id: input.customer_id,
    p_cash_session_id: input.cash_session_id,
    p_notes: input.notes.trim() || null,
  });
  if (error) throw error;
  if (typeof data !== "string") {
    throw new Error("Supabase no confirmó la venta.");
  }
  return data;
}

export async function fetchSalesHistory(): Promise<SaleRecord[]> {
  const client = requireSupabase();
  const { data: sales, error: salesError } = await client
    .from("sales")
    .select(
      "id, sale_number, created_by, customer_id, cash_session_id, status, payment_method, subtotal_cop, discount_cop, total_cop, notes, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (salesError) throw salesError;
  const saleRows = sales ?? [];
  if (!saleRows.length) return [];

  const ids = saleRows.map((sale) => sale.id);
  const customerIds = [...new Set(
    saleRows.map((sale) => sale.customer_id).filter((id): id is string => Boolean(id)),
  )];
  const [itemsResult, customersResult, adjustmentsResult] = await Promise.all([
    client
      .from("sale_items")
      .select(
        "id, sale_id, item_type, retail_product_id, recipe_id, item_name_snapshot, product_type_snapshot, size_ml_snapshot, recipe_version_snapshot, quantity, unit_price_cop, line_total_cop, created_at",
      )
      .in("sale_id", ids)
      .order("created_at"),
    customerIds.length
      ? client.from("customers").select("id, full_name, phone").in("id", customerIds)
      : Promise.resolve({ data: [], error: null }),
    client
      .from("sale_adjustments")
      .select("id, sale_id, operation, reason, amount_cop, inventory_restored, refund_payment_method, created_at")
      .in("sale_id", ids),
  ]);
  if (itemsResult.error) throw itemsResult.error;
  if (customersResult.error) throw customersResult.error;
  if (adjustmentsResult.error) throw adjustmentsResult.error;

  const itemsBySale = new Map<string, NonNullable<typeof itemsResult.data>>();
  for (const item of itemsResult.data ?? []) {
    const bucket = itemsBySale.get(item.sale_id) ?? [];
    bucket.push(item);
    itemsBySale.set(item.sale_id, bucket);
  }
  const customersById = new Map(
    (customersResult.data ?? []).map((customer) => [customer.id, customer]),
  );
  const adjustmentsBySale = new Map(
    (adjustmentsResult.data ?? []).map((adjustment) => [
      adjustment.sale_id,
      adjustment,
    ]),
  );

  return saleRows.map((sale) => ({
    ...sale,
    payment_method: sale.payment_method as PaymentMethod,
    customer: normalizeOne(
      sale.customer_id ? customersById.get(sale.customer_id) ?? null : null,
    ),
    items: (itemsBySale.get(sale.id) ?? []) as SaleRecord["items"],
    adjustment: (
      adjustmentsBySale.get(sale.id) ?? null
    ) as SaleRecord["adjustment"],
  })) as SaleRecord[];
}

export async function configurePaymentMethod(input: {
  method: PaymentMethod;
  label: string;
  enabled: boolean;
}): Promise<void> {
  const { error } = await requireSupabase().rpc("admin_configure_payment_method", {
    p_method: input.method,
    p_label: input.label,
    p_enabled: input.enabled,
  });
  if (error) throw error;
}

export async function reverseSale(input: {
  sale_id: string;
  operation: "void" | "refund";
  reason: string;
  restore_inventory: boolean;
  refund_payment_method: PaymentMethod | null;
  cash_session_id: string | null;
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc("admin_reverse_sale", {
    p_sale_id: input.sale_id,
    p_operation: input.operation,
    p_reason: input.reason,
    p_restore_inventory: input.restore_inventory,
    p_refund_payment_method: input.refund_payment_method,
    p_cash_session_id: input.cash_session_id,
  });
  if (error) throw error;
  if (typeof data !== "string") {
    throw new Error("Supabase no confirmó la reversión de la venta.");
  }
  return data;
}
