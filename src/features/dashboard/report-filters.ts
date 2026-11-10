import { supabase } from "@/lib/supabase";

export const reportFilterQueryKeys = {
  options: ["report-filter-options"] as const,
};

export interface ReportProductOption {
  id: string;
  name: string;
  product_type: string;
}

export interface ReportRecipeOption {
  id: string;
  name: string;
  brand: string;
  size_ml: number;
}

export interface ReportEmployeeOption {
  id: string;
  display_name: string;
}

export async function fetchReportFilterOptions(): Promise<{
  products: ReportProductOption[];
  recipes: ReportRecipeOption[];
  employees: ReportEmployeeOption[];
}> {
  if (!supabase) throw new Error("Supabase no está conectado.");
  const [productsResult, recipesResult, employeesResult] = await Promise.all([
    supabase
      .from("retail_products")
      .select("id, name, product_type")
      .eq("active", true)
      .order("name")
      .limit(500),
    supabase
      .from("recipes")
      .select("id, size_ml, perfumes(name, brand)")
      .eq("status", "active")
      .order("size_ml")
      .limit(500),
    supabase
      .from("profiles")
      .select("id, display_name")
      .order("display_name")
      .limit(100),
  ]);
  if (productsResult.error) throw productsResult.error;
  if (recipesResult.error) throw recipesResult.error;
  if (employeesResult.error) throw employeesResult.error;
  const recipes = (recipesResult.data ?? []).map((row) => {
    const perfume = Array.isArray(row.perfumes) ? row.perfumes[0] : row.perfumes;
    return {
      id: row.id,
      size_ml: row.size_ml,
      name: perfume?.name ?? "Perfume",
      brand: perfume?.brand ?? "",
    };
  });
  return {
    products: productsResult.data ?? [],
    recipes,
    employees: employeesResult.data ?? [],
  };
}
