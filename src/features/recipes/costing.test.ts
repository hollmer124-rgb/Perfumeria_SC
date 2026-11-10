import { describe, expect, it } from "vitest";
import type { InventoryCost } from "@/features/inventory/types";
import { estimateManufactureCost, estimateRecipeCost } from "@/features/recipes/costing";
import type { Recipe } from "@/features/recipes/types";

const recipe: Recipe = {
  id: "recipe-1",
  perfume_id: "perfume-1",
  size_ml: 30,
  version: 1,
  status: "active",
  price_cop: 50000,
  created_by: null,
  created_at: "",
  updated_at: "",
  perfumes: { id: "perfume-1", name: "DEMO - Winner Sport", brand: "DEMO" },
  recipe_components: [
    {
      id: "component-1",
      material_id: "essence",
      mode: "fixed",
      quantity: 15,
      materials: {
        id: "essence",
        name: "Esencia demo",
        base_unit: "g",
        on_hand_qty: 100,
        category: "essence",
        size_ml: null,
      },
    },
    {
      id: "component-2",
      material_id: "alcohol",
      mode: "fill_to_volume",
      quantity: null,
      materials: {
        id: "alcohol",
        name: "Alcohol demo",
        base_unit: "ml",
        on_hand_qty: 100,
        category: "alcohol",
        size_ml: null,
      },
    },
  ],
};

const costs: InventoryCost[] = [
  {
    item_kind: "material",
    item_id: "essence",
    item_name: "Esencia demo",
    quantity_on_hand: 100,
    unit: "g",
    avg_unit_cost_cop: 100,
    inventory_value_cop: 10000,
  },
  {
    item_kind: "material",
    item_id: "alcohol",
    item_name: "Alcohol demo",
    quantity_on_hand: 100,
    unit: "ml",
    avg_unit_cost_cop: 10,
    inventory_value_cop: 1000,
  },
];

describe("recipe cost estimates", () => {
  it("does not invent a fill amount for a variable component", () => {
    expect(estimateRecipeCost(recipe, costs)).toBeNull();
  });

  it("uses the measured fill without converting fixed grams to milliliters", () => {
    expect(estimateRecipeCost(recipe, costs, 12.5)).toBe(1625);
    expect(estimateManufactureCost(recipe, costs, 2, 12.5)).toBe(3250);
  });
});
