import type { SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export let supabase: SupabaseClient | null = null;

let clientInitialization: Promise<SupabaseClient | null> | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseKey);
}

export function initializeSupabase(): Promise<SupabaseClient | null> {
  const url = supabaseUrl;
  const key = supabaseKey;
  if (!url || !key) return Promise.resolve(null);
  if (clientInitialization) return clientInitialization;

  clientInitialization = import("@supabase/supabase-js")
    .then(({ createClient }) => {
      supabase = createClient(url, key, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: true,
          persistSession: true,
        },
      });
      return supabase;
    })
    .catch((error: unknown) => {
      clientInitialization = null;
      throw error;
    });

  return clientInitialization;
}
