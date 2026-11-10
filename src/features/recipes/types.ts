import type { Material, Perfume } from "@/features/inventory/types";

export type RecipeStatus = "draft" | "active" | "archived";
export type RecipeComponentMode = "fixed" | "fill_to_volume";

export interface RecipeComponent {
  id: string;
  material_id: string;
  mode: RecipeComponentMode;
  quantity: number | null;
  materials: Pick<
    Material,
    "id" | "name" | "base_unit" | "on_hand_qty" | "category" | "size_ml"
  > | null;
}

export interface Recipe {
  id: string;
  perfume_id: string;
  size_ml: number;
  version: number;
  status: RecipeStatus;
  price_cop: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  perfumes: Pick<Perfume, "id" | "name" | "brand"> | null;
  recipe_components: RecipeComponent[];
}

export interface RecipeComponentInput {
  material_id: string;
  mode: RecipeComponentMode;
  quantity: number | null;
}

export interface RecipeSaveInput {
  recipe_id: string | null;
  perfume_id: string;
  size_ml: number;
  price_cop: number;
  components: RecipeComponentInput[];
}

export interface RecipeCustomer {
  id: string;
  full_name: string;
}

export interface OpenCashSession {
  id: string;
  opened_by: string;
}
