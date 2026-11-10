import type { InventoryCost } from "@/features/inventory/types";
import type { Recipe } from "@/features/recipes/types";

export function estimateRecipeCost(
  recipe: Recipe,
  costs: InventoryCost[],
  fillConsumptionMl?: number,
): number | null {
  const costsByMaterial = new Map(
    costs
      .filter((cost) => cost.item_kind === "material")
      .map((cost) => [cost.item_id, cost.avg_unit_cost_cop]),
  );
  let total = 0;

  for (const component of recipe.recipe_components) {
    const unitCost = costsByMaterial.get(component.material_id);
    if (unitCost === undefined) return null;
    if (component.mode === "fill_to_volume" && fillConsumptionMl === undefined) {
      return null;
    }

    const amount =
      component.mode === "fill_to_volume"
        ? fillConsumptionMl
        : component.quantity;
    if (amount === null || amount === undefined) return null;
    total += Math.round(amount * unitCost);
  }
  return total;
}

export function estimateManufactureCost(
  recipe: Recipe,
  costs: InventoryCost[],
  quantity: number,
  fillConsumptionMl?: number,
): number | null {
  const costsByMaterial = new Map(
    costs
      .filter((cost) => cost.item_kind === "material")
      .map((cost) => [cost.item_id, cost.avg_unit_cost_cop]),
  );
  let total = 0;

  for (const component of recipe.recipe_components) {
    const unitCost = costsByMaterial.get(component.material_id);
    if (unitCost === undefined) return null;
    if (component.mode === "fill_to_volume" && fillConsumptionMl === undefined) {
      return null;
    }

    const perBottle =
      component.mode === "fill_to_volume"
        ? fillConsumptionMl
        : component.quantity;
    if (perBottle === null || perBottle === undefined) return null;
    total += Math.round(perBottle * quantity * unitCost);
  }
  return total;
}
