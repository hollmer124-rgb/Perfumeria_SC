import { supabase } from "@/lib/supabase";

export interface Customer {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CustomerSale {
  id: string;
  sale_number: number;
  status: string;
  payment_method: string;
  total_cop: number;
  created_at: string;
}

export interface CustomerPage {
  rows: Customer[];
  total: number;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase no está conectado. Revisa la configuración e inténtalo de nuevo.");
  }
  return supabase;
}

export const customerQueryKeys = {
  all: ["customers"] as const,
  page: (search: string, page: number) =>
    [...customerQueryKeys.all, search, page] as const,
  detail: (id: string) => [...customerQueryKeys.all, "detail", id] as const,
  sales: (id: string) => [...customerQueryKeys.all, id, "sales"] as const,
};

function safeSearchTerm(value: string) {
  return value.replace(/[^\p{L}\p{N}@.+\- ]/gu, "").trim();
}

export async function fetchCustomerPage(
  search: string,
  page: number,
  pageSize: number,
): Promise<CustomerPage> {
  const term = safeSearchTerm(search);
  let query = requireSupabase()
    .from("customers")
    .select(
      "id, full_name, phone, email, notes, created_by, created_at, updated_at",
      { count: "exact" },
    )
    .order("full_name")
    .range(page * pageSize, page * pageSize + pageSize - 1);
  if (term) {
    const pattern = `%${term}%`;
    query = query.or(
      `full_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`,
    );
  }
  const { data, count, error } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as Customer[], total: count ?? 0 };
}

export async function fetchCustomerSales(id: string): Promise<CustomerSale[]> {
  const { data, error } = await requireSupabase()
    .from("sales")
    .select("id, sale_number, status, payment_method, total_cop, created_at")
    .eq("customer_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as CustomerSale[];
}

export async function hasPossibleCustomerDuplicate(
  email: string | null,
  phone: string | null,
  excludingId?: string,
): Promise<boolean> {
  const client = requireSupabase();
  const checks: Promise<boolean>[] = [];
  if (email) {
    let query = client.from("customers").select("id").ilike("email", email).limit(1);
    if (excludingId) query = query.neq("id", excludingId);
    checks.push((async () => {
      const { data, error } = await query;
      if (error) throw error;
      return Boolean(data?.length);
    })());
  }
  if (phone) {
    let query = client.from("customers").select("id").eq("phone", phone).limit(1);
    if (excludingId) query = query.neq("id", excludingId);
    checks.push((async () => {
      const { data, error } = await query;
      if (error) throw error;
      return Boolean(data?.length);
    })());
  }
  const results = await Promise.all(checks);
  return results.some(Boolean);
}
