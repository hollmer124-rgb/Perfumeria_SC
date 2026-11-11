import { supabase } from "@/lib/supabase";

export interface BusinessSettings {
  id: number;
  business_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  updated_at: string;
}

export interface StaffProfile {
  id: string;
  display_name: string;
  role: "admin" | "employee";
  phone: string | null;
  created_at: string;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase no está conectado. Revisa la configuración e inténtalo de nuevo.");
  }
  return supabase;
}

export const settingsQueryKeys = {
  business: ["business-settings"] as const,
  staff: ["staff-profiles"] as const,
  profile: (id: string) => ["account-profile", id] as const,
};

export type BusinessSettingsValues = Pick<
  BusinessSettings,
  "business_name" | "phone" | "email" | "address"
>;

function logBusinessSettingsError(context: string, error: unknown) {
  if (!import.meta.env.DEV) return;
  const record =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : null;
  console.error(context, {
    code: typeof record?.code === "string" ? record.code : undefined,
    message: typeof record?.message === "string" ? record.message : undefined,
    status: typeof record?.status === "number" ? record.status : undefined,
  });
}

export async function fetchBusinessSettings(): Promise<BusinessSettings | null> {
  const { data, error } = await requireSupabase()
    .from("business_settings")
    .select("id, business_name, phone, email, address, updated_at")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    logBusinessSettingsError("Business settings fetch failed", error);
    throw error;
  }
  return data as BusinessSettings | null;
}

export async function updateBusinessSettings(
  values: BusinessSettingsValues,
): Promise<void> {
  const { data, error } = await requireSupabase()
    .from("business_settings")
    .update(values)
    .eq("id", 1)
    .select("id")
    .maybeSingle();
  if (error) {
    logBusinessSettingsError("Business settings update failed", error);
    throw error;
  }
  if (!data) {
    throw new Error(
      "No se encontró la configuración del negocio o no tienes permiso para modificarla.",
    );
  }
}

export async function fetchStaffProfiles(): Promise<StaffProfile[]> {
  const { data, error } = await requireSupabase()
    .from("profiles")
    .select("id, display_name, role, phone, created_at")
    .order("display_name");
  if (error) throw error;
  return (data ?? []) as StaffProfile[];
}

export async function fetchAccountProfile(id: string) {
  const { data, error } = await requireSupabase()
    .from("profiles")
    .select("id, display_name, role, phone, created_at, updated_at")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as StaffProfile & { updated_at: string };
}
