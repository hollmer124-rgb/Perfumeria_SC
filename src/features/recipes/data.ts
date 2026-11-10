import { supabase } from "@/lib/supabase";
import type { InventoryCost, Material, Perfume } from "@/features/inventory/types";
import type {
  OpenCashSession,
  Recipe,
  RecipeCustomer,
  RecipeSaveInput,
} from "@/features/recipes/types";

export const recipeQueryKeys = {
  recipes: ["recipes"] as const,
  materials: ["materials"] as const,
  perfumes: ["perfumes"] as const,
  costs: ["inventory-costs"] as const,
  customers: ["recipe-customers"] as const,
  cashSessions: ["recipe-open-cash-sessions"] as const,
};

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase no está conectado. Revisa la configuración e inténtalo de nuevo.");
  }
  return supabase;
}

function normalizeOne<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export async function fetchRecipes(): Promise<Recipe[]> {
  const { data, error } = await requireSupabase()
    .from("recipes")
    .select(
      "id, perfume_id, size_ml, version, status, price_cop, created_by, created_at, updated_at, perfumes(id, name, brand), recipe_components(id, material_id, mode, quantity, materials(id, name, base_unit, on_hand_qty, category, size_ml))",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const recipe = row as unknown as Recipe & {
      perfumes: Recipe["perfumes"] | Recipe["perfumes"][];
      recipe_components: Array<
        Recipe["recipe_components"][number] & {
          materials:
            | Recipe["recipe_components"][number]["materials"]
            | Recipe["recipe_components"][number]["materials"][];
        }
      >;
    };
    return {
      ...recipe,
      perfumes: normalizeOne(recipe.perfumes),
      recipe_components: (recipe.recipe_components ?? []).map((component) => ({
        ...component,
        materials: normalizeOne(component.materials),
      })),
    };
  });
}

export async function fetchRecipeMaterials(): Promise<Material[]> {
  const { data, error } = await requireSupabase()
    .from("materials")
    .select("id, name, base_unit, on_hand_qty, minimum_qty, category, perfume_id, supplier_id, size_ml, active, created_at")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return (data ?? []) as Material[];
}

export async function fetchRecipePerfumes(): Promise<Perfume[]> {
  const { data, error } = await requireSupabase()
    .from("perfumes")
    .select("id, name, brand, active")
    .eq("active", true)
    .order("brand")
    .order("name");
  if (error) throw error;
  return (data ?? []) as Perfume[];
}

export async function fetchRecipeCosts(): Promise<InventoryCost[]> {
  const { data, error } = await requireSupabase().rpc("admin_inventory_costs");
  if (error) throw error;
  return (data ?? []) as InventoryCost[];
}

export async function fetchRecipeCustomers(): Promise<RecipeCustomer[]> {
  const { data, error } = await requireSupabase()
    .from("customers")
    .select("id, full_name")
    .order("full_name");
  if (error) throw error;
  return (data ?? []) as RecipeCustomer[];
}

export async function fetchOpenCashSessions(
  userId: string,
): Promise<OpenCashSession[]> {
  const { data, error } = await requireSupabase()
    .from("cash_sessions")
    .select("id, opened_by")
    .eq("status", "open")
    .eq("opened_by", userId)
    .order("opened_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as OpenCashSession[];
}

export async function saveRecipe(values: RecipeSaveInput): Promise<string> {
  const { data, error } = await requireSupabase().rpc("admin_save_recipe", {
    p_recipe_id: values.recipe_id,
    p_perfume_id: values.perfume_id,
    p_size_ml: values.size_ml,
    p_price_cop: values.price_cop,
    p_components: values.components,
  });
  if (error) throw error;
  if (typeof data !== "string") {
    throw new Error("Supabase no confirmó la receta guardada.");
  }
  return data;
}

export async function activateRecipe(recipeId: string): Promise<void> {
  const { error } = await requireSupabase().rpc("activate_recipe", {
    p_recipe_id: recipeId,
  });
  if (error) throw error;
}

export async function createRecipeVersion(recipeId: string): Promise<string> {
  const { data, error } = await requireSupabase().rpc("create_recipe_version", {
    p_recipe_id: recipeId,
  });
  if (error) throw error;
  if (typeof data !== "string") {
    throw new Error("Supabase no confirmó la nueva versión.");
  }
  return data;
}

export async function manufactureRecipe(input: {
  recipe_id: string;
  quantity: number;
  fill_consumption_ml: number | null;
  payment_method: "cash" | "transfer" | "card" | "other";
  customer_id: string | null;
  cash_session_id: string | null;
  notes: string;
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc(
    "register_recipe_manufacture",
    {
      p_recipe_id: input.recipe_id,
      p_quantity: input.quantity,
      p_fill_consumption_ml: input.fill_consumption_ml,
      p_payment_method: input.payment_method,
      p_customer_id: input.customer_id,
      p_cash_session_id: input.cash_session_id,
      p_notes: input.notes.trim() || null,
    },
  );
  if (error) throw error;
  if (typeof data !== "string") {
    throw new Error("Supabase no confirmó la fabricación y venta.");
  }
  return data;
}
