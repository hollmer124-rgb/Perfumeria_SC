import { describe, expect, it } from "vitest";
import {
  materialPerfumeIdForSave,
  materialSchema,
} from "@/features/inventory/material-form";

const essenceForm = {
  name: "Esencia sin referencia",
  category: "essence",
  base_unit: "g",
  supplier_id: "",
  size_ml: "",
  minimum_qty: "0",
  active: "true",
};

describe("material form", () => {
  it("accepts a new essence without an olfactory reference", () => {
    expect(materialSchema.safeParse(essenceForm).success).toBe(true);
    expect(materialPerfumeIdForSave("essence", null)).toBeNull();
  });

  it("preserves an existing essence reference when editing the hidden field", () => {
    expect(
      materialPerfumeIdForSave("essence", {
        category: "essence",
        perfume_id: "reference-1",
      }),
    ).toBe("reference-1");
    expect(
      materialPerfumeIdForSave("essence", {
        category: "essence",
        perfume_id: null,
      }),
    ).toBeNull();
  });

  it("clears the reference when the material is no longer an essence", () => {
    expect(
      materialPerfumeIdForSave("other", {
        category: "essence",
        perfume_id: "reference-1",
      }),
    ).toBeNull();
  });

  it("keeps bottle unit and size validation", () => {
    expect(
      materialSchema.safeParse({
        ...essenceForm,
        category: "bottle",
        base_unit: "unit",
        size_ml: "30",
      }).success,
    ).toBe(true);
    expect(
      materialSchema.safeParse({
        ...essenceForm,
        category: "bottle",
        base_unit: "ml",
        size_ml: "30",
      }).success,
    ).toBe(false);
  });
});
