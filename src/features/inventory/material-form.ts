import { z } from "zod";
import type { Material, MaterialCategory } from "@/features/inventory/types";

export const materialSchema = z
  .object({
    name: z.string().trim().min(1, "Ingresa el nombre.").max(180),
    category: z.enum(["essence", "alcohol", "pheromone", "bottle", "other"]),
    base_unit: z.enum(["g", "ml", "unit", "dose"]),
    supplier_id: z.string(),
    size_ml: z.string(),
    minimum_qty: z.string().regex(/^\d+([.]\d{1,4})?$/, "Ingresa una cantidad válida."),
    active: z.enum(["true", "false"]),
  })
  .superRefine((values, context) => {
    if (values.category === "bottle" && !values.size_ml) {
      context.addIssue({
        code: "custom",
        message: "Selecciona la presentación del frasco.",
        path: ["size_ml"],
      });
    }
    if (values.category === "bottle" && values.base_unit !== "unit") {
      context.addIssue({
        code: "custom",
        message: "Los frascos se controlan por unidades.",
        path: ["base_unit"],
      });
    }
    if (values.category !== "bottle" && values.size_ml) {
      context.addIssue({
        code: "custom",
        message: "El tamaño solo aplica a frascos.",
        path: ["size_ml"],
      });
    }
  });

export type MaterialValues = z.infer<typeof materialSchema>;

export const emptyMaterialValues: MaterialValues = {
  name: "",
  category: "other",
  base_unit: "unit",
  supplier_id: "",
  size_ml: "",
  minimum_qty: "0",
  active: "true",
};

export function materialPerfumeIdForSave(
  category: MaterialCategory,
  existing: Pick<Material, "category" | "perfume_id"> | null,
): string | null {
  if (category !== "essence") return null;
  return existing?.category === "essence" ? existing.perfume_id : null;
}
