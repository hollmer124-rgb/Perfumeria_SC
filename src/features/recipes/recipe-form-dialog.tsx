import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import type { Material, Perfume } from "@/features/inventory/types";
import type { Recipe, RecipeComponentInput, RecipeComponentMode } from "@/features/recipes/types";
import { formatQuantity } from "@/features/inventory/format";
import { notify } from "@/lib/notifications";

interface ComponentDraft {
  material_id: string;
  mode: RecipeComponentMode;
  quantity: string;
}

interface RecipeFormValues {
  perfume_id: string;
  size_ml: number;
  price_cop: string;
  components: ComponentDraft[];
}

const sizes = [30, 50, 60, 100] as const;
const unitLabels: Record<string, string> = {
  g: "g",
  ml: "ml",
  unit: "unidades",
  dose: "dosis",
};

function formValues(recipe: Recipe | null): RecipeFormValues {
  return {
    perfume_id: recipe?.perfume_id ?? "",
    size_ml: recipe?.size_ml ?? 30,
    price_cop: recipe ? String(recipe.price_cop) : "",
    components: recipe?.recipe_components.map((component) => ({
      material_id: component.material_id,
      mode: component.mode,
      quantity: component.quantity === null ? "" : String(component.quantity),
    })) ?? [{ material_id: "", mode: "fixed", quantity: "" }],
  };
}

export function RecipeFormDialog({
  open,
  onOpenChange,
  recipe,
  perfumes,
  materials,
  isSaving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipe: Recipe | null;
  perfumes: Perfume[];
  materials: Material[];
  isSaving: boolean;
  onSave: (values: {
    recipe_id: string | null;
    perfume_id: string;
    size_ml: number;
    price_cop: number;
    components: RecipeComponentInput[];
  }) => Promise<void>;
}) {
  const [values, setValues] = useState<RecipeFormValues>(() => formValues(recipe));

  function updateComponent(index: number, patch: Partial<ComponentDraft>) {
    setValues((current) => ({
      ...current,
      components: current.components.map((component, componentIndex) =>
        componentIndex === index ? { ...component, ...patch } : component,
      ),
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const price = Number(values.price_cop);
    if (!values.perfume_id) {
      notify.error("Selecciona un perfume del catálogo.");
      return;
    }
    if (!/^\d+$/.test(values.price_cop) || !Number.isSafeInteger(price) || price < 0) {
      notify.error("Ingresa un precio entero válido en COP.");
      return;
    }
    if (!values.components.length) {
      notify.error("Agrega al menos un componente a la fórmula.");
      return;
    }

    const seen = new Set<string>();
    let fillCount = 0;
    const components: RecipeComponentInput[] = [];
    for (const component of values.components) {
      const material = materials.find((item) => item.id === component.material_id);
      if (!material) {
        notify.error("Selecciona un material activo para cada componente.");
        return;
      }
      if (seen.has(component.material_id)) {
        notify.error("Cada material debe aparecer una sola vez en la fórmula.");
        return;
      }
      seen.add(component.material_id);

      if (component.mode === "fill_to_volume") {
        fillCount += 1;
        if (material.base_unit !== "ml") {
          notify.error("El componente para completar volumen debe medirse en ml.");
          return;
        }
        components.push({
          material_id: material.id,
          mode: component.mode,
          quantity: null,
        });
      } else {
        const quantity = Number(component.quantity);
        if (
          !/^\d+(\.\d{1,4})?$/.test(component.quantity) ||
          !Number.isFinite(quantity) ||
          quantity <= 0
        ) {
          notify.error(`Ingresa una cantidad positiva en ${unitLabels[material.base_unit]}.`);
          return;
        }
        components.push({
          material_id: material.id,
          mode: component.mode,
          quantity,
        });
      }
    }
    if (fillCount > 1) {
      notify.error("La fórmula admite un solo componente de volumen variable.");
      return;
    }
    const fixedMl = values.components.reduce((total, component) => {
      const material = materials.find((item) => item.id === component.material_id);
      if (component.mode !== "fixed" || material?.base_unit !== "ml") return total;
      return total + Number(component.quantity);
    }, 0);
    if (fillCount && fixedMl >= values.size_ml) {
      notify.error("Los componentes fijos en ml deben dejar volumen para completar.");
      return;
    }

    try {
      await onSave({
        recipe_id: recipe?.id ?? null,
        perfume_id: values.perfume_id,
        size_ml: values.size_ml,
        price_cop: price,
        components,
      });
    } catch {
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{recipe ? `Editar borrador · versión ${recipe.version}` : "Nueva fórmula"}</DialogTitle>
          <DialogDescription>
            Cada presentación tiene su propia fórmula. Las versiones activas se conservan y no se editan.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Perfume" required>
              {(props) => (
                <select
                  {...props}
                  className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm disabled:opacity-70"
                  disabled={Boolean(recipe)}
                  onChange={(event) => setValues((current) => ({ ...current, perfume_id: event.target.value }))}
                  value={values.perfume_id}
                >
                  <option value="">Selecciona un perfume</option>
                  {perfumes.map((perfume) => (
                    <option key={perfume.id} value={perfume.id}>
                      {perfume.brand} · {perfume.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label="Presentación" required>
              {(props) => (
                <select
                  {...props}
                  className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm disabled:opacity-70"
                  disabled={Boolean(recipe)}
                  onChange={(event) => setValues((current) => ({ ...current, size_ml: Number(event.target.value) }))}
                  value={values.size_ml}
                >
                  {sizes.map((size) => <option key={size} value={size}>{size} ml</option>)}
                </select>
              )}
            </FormField>
            <FormField label="Precio de venta (COP)" required>
              {(props) => (
                <Input
                  {...props}
                  inputMode="numeric"
                  min="0"
                  onChange={(event) => setValues((current) => ({ ...current, price_cop: event.target.value }))}
                  type="number"
                  value={values.price_cop}
                />
              )}
            </FormField>
          </div>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-medium">Componentes</h3>
                <p className="text-xs text-muted-foreground">No se convierten gramos a mililitros.</p>
              </div>
              <Button
                onClick={() => setValues((current) => ({
                  ...current,
                  components: [...current.components, { material_id: "", mode: "fixed", quantity: "" }],
                }))}
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus aria-hidden="true" size={15} />
                Agregar
              </Button>
            </div>
            <div className="grid gap-3">
              {values.components.map((component, index) => {
                const material = materials.find((item) => item.id === component.material_id);
                return (
                  <div className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end" key={`${index}-${component.material_id}`}>
                    <FormField label="Material" required>
                      {(props) => (
                        <select
                          {...props}
                          className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                          onChange={(event) => updateComponent(index, {
                            material_id: event.target.value,
                            ...(component.mode === "fill_to_volume" &&
                              materials.find((item) => item.id === event.target.value)?.base_unit !== "ml"
                              ? { mode: "fixed", quantity: "" }
                              : {}),
                          })}
                          value={component.material_id}
                        >
                          <option value="">Selecciona material</option>
                          {materials.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} · {unitLabels[item.base_unit]} · stock {formatQuantity(item.on_hand_qty)}
                            </option>
                          ))}
                        </select>
                      )}
                    </FormField>
                    <FormField label="Tipo de cantidad">
                      {(props) => (
                        <select
                          {...props}
                          className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                          onChange={(event) => updateComponent(index, {
                            mode: event.target.value as RecipeComponentMode,
                            quantity: event.target.value === "fill_to_volume" ? "" : component.quantity,
                          })}
                          value={component.mode}
                        >
                          <option value="fixed">Fija</option>
                          <option disabled={material?.base_unit !== "ml"} value="fill_to_volume">Hasta completar volumen</option>
                        </select>
                      )}
                    </FormField>
                    <FormField label={component.mode === "fill_to_volume" ? "Consumo" : `Cantidad (${material ? unitLabels[material.base_unit] : "unidad"})`}>
                      {(props) => (
                        component.mode === "fill_to_volume" ? (
                          <Input {...props} disabled value="Se mide al fabricar" />
                        ) : (
                          <Input
                            {...props}
                            inputMode="decimal"
                            min="0.0001"
                            onChange={(event) => updateComponent(index, { quantity: event.target.value })}
                            step="0.0001"
                            type="number"
                            value={component.quantity}
                          />
                        )
                      )}
                    </FormField>
                    <Button
                      aria-label="Quitar componente"
                      className="sm:mb-0.5"
                      disabled={values.components.length === 1}
                      onClick={() => setValues((current) => ({
                        ...current,
                        components: current.components.filter((_, itemIndex) => itemIndex !== index),
                      }))}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" size={16} />
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">Cancelar</Button>
            <Button disabled={isSaving || materials.length === 0 || perfumes.length === 0} type="submit">
              {isSaving ? "Guardando…" : "Guardar borrador"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
