import { useMemo, useState, type FormEvent } from "react";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCop, formatQuantity } from "@/features/inventory/format";
import { estimateManufactureCost } from "@/features/recipes/costing";
import type { InventoryCost } from "@/features/inventory/types";
import type { OpenCashSession, Recipe, RecipeCustomer } from "@/features/recipes/types";
import type { PaymentMethod, PaymentMethodOption } from "@/features/sales/types";
import { notify } from "@/lib/notifications";

const unitLabels: Record<string, string> = {
  g: "g",
  ml: "ml",
  unit: "unidades",
  dose: "dosis",
};

export function ManufactureDialog({
  open,
  onOpenChange,
  recipe,
  costs,
  customers,
  cashSessions,
  paymentMethods,
  showFinancials,
  isSaving,
  onManufacture,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipe: Recipe | null;
  costs: InventoryCost[];
  customers: RecipeCustomer[];
  cashSessions: OpenCashSession[];
  paymentMethods: PaymentMethodOption[];
  showFinancials: boolean;
  isSaving: boolean;
  onManufacture: (input: {
    recipe_id: string;
    quantity: number;
    fill_consumption_ml: number | null;
    payment_method: PaymentMethod;
    customer_id: string | null;
    cash_session_id: string | null;
    notes: string;
    idempotency_key: string;
  }) => Promise<void>;
}) {
  const [quantity, setQuantity] = useState("1");
  const [fillConsumption, setFillConsumption] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [cashSessionId, setCashSessionId] = useState("");
  const [notes, setNotes] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const enabledPaymentMethods = paymentMethods.filter((method) => method.enabled);
  const hasEnabledPaymentMethod = enabledPaymentMethods.some(
    (method) => method.method === paymentMethod,
  );
  const count = Number(quantity);
  const fillComponent = recipe?.recipe_components.find(
    (component) => component.mode === "fill_to_volume",
  );
  const maximumFillMl = recipe
    ? recipe.size_ml - recipe.recipe_components.reduce(
        (sum, component) =>
          component.mode === "fixed" &&
          component.materials?.base_unit === "ml"
            ? sum + (component.quantity ?? 0)
            : sum,
        0,
      )
    : 0;
  const fillValue = fillConsumption === "" ? undefined : Number(fillConsumption);
  const validCount = /^\d+$/.test(quantity) && Number.isSafeInteger(count) && count > 0;
  const costEstimate = useMemo(
    () =>
      recipe && validCount && showFinancials
        ? estimateManufactureCost(recipe, costs, count, fillValue)
        : null,
    [costs, count, fillValue, recipe, showFinancials, validCount],
  );

  const stockShortages = useMemo(() => {
    if (!recipe || !validCount) return [];
    return recipe.recipe_components.flatMap((component) => {
      const material = component.materials;
      if (!material) return [];
      const perBottle =
        component.mode === "fill_to_volume" ? fillValue : component.quantity;
      if (perBottle === undefined || perBottle === null) return [];
      const needed = perBottle * count;
      return material.on_hand_qty < needed
        ? [{ name: material.name, needed, available: material.on_hand_qty, unit: material.base_unit }]
        : [];
    });
  }, [count, fillValue, recipe, validCount]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recipe) return;
    if (!validCount || count > 999999) {
      notify.error("La cantidad de unidades debe ser un entero positivo.");
      return;
    }
    if (fillComponent && (
      fillValue === undefined ||
      !/^\d+(\.\d{1,4})?$/.test(fillConsumption) ||
      fillValue <= 0 ||
      fillValue > maximumFillMl
    )) {
      notify.error(`Registra el consumo real medido en ml (mayor que 0 y hasta ${formatQuantity(maximumFillMl)} ml, descontando los componentes fijos medidos en ml).`);
      return;
    }
    if (!fillComponent && fillConsumption.trim()) {
      notify.error("Esta fórmula no tiene un componente de volumen variable.");
      return;
    }
    if (!cashSessionId) {
      notify.error("Selecciona una caja abierta para asociar la venta.");
      return;
    }
    if (!paymentMethod || !hasEnabledPaymentMethod) {
      notify.error("Selecciona un método de pago habilitado.");
      return;
    }
    if (stockShortages.length) {
      notify.error(`Existencias insuficientes: ${stockShortages.map((item) => item.name).join(", ")}.`);
      return;
    }
    try {
      await onManufacture({
        recipe_id: recipe.id,
        quantity: count,
        fill_consumption_ml: fillComponent ? fillValue ?? null : null,
        payment_method: paymentMethod,
        customer_id: customerId || null,
        cash_session_id: paymentMethod === "cash" ? cashSessionId || null : null,
        notes,
        idempotency_key: idempotencyKey,
      });
      setIdempotencyKey(crypto.randomUUID());
    } catch {
      return;
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isSaving) return;
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setQuantity("1");
          setFillConsumption("");
          setCustomerId("");
          setPaymentMethod("");
          setCashSessionId("");
          setNotes("");
          setIdempotencyKey(crypto.randomUUID());
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fabricación bajo pedido</DialogTitle>
          <DialogDescription>
            La fabricación queda vinculada a la venta. No se crean unidades terminadas en inventario.
          </DialogDescription>
        </DialogHeader>
        {recipe ? (
          <form className="grid gap-4" onSubmit={submit}>
            <Card className="bg-muted/30">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FlaskConical aria-hidden="true" className="text-gold" size={17} />
                  {recipe.perfumes?.brand} · {recipe.perfumes?.name} · {recipe.size_ml} ml
                  <span className="ml-auto text-xs font-normal text-muted-foreground">v{recipe.version}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {recipe.recipe_components.map((component) => {
                  const material = component.materials;
                  return (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm" key={component.id}>
                      <span>{material?.name ?? "Material no disponible"}</span>
                      <span className="text-muted-foreground">
                        {component.mode === "fill_to_volume"
                          ? fillValue && fillValue > 0
                            ? `${formatQuantity(fillValue)} ml medidos por unidad`
                            : "Registrar consumo medido"
                          : `${formatQuantity(component.quantity ?? 0)} ${material ? unitLabels[material.base_unit] : ""} por unidad`}
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Unidades fabricadas" required>
                {(props) => (
                  <Input
                    {...props}
                    disabled={isSaving}
                    inputMode="numeric"
                    min="1"
                    onChange={(event) => {
                      setQuantity(event.target.value);
                      setIdempotencyKey(crypto.randomUUID());
                    }}
                    step="1"
                    type="number"
                    value={quantity}
                  />
                )}
              </FormField>
              {fillComponent ? (
                <FormField
                  description={`Mide el alcohol real usado por cada frasco. Máximo ${formatQuantity(maximumFillMl)} ml según los componentes fijos en ml; no se convierten gramos a mililitros.`}
                  label={`${fillComponent.materials?.name ?? "Componente variable"} consumido por unidad (ml)`}
                  required
                >
                  {(props) => (
                    <Input
                      {...props}
                      disabled={isSaving}
                      inputMode="decimal"
                      min="0.0001"
                      max={maximumFillMl}
                      onChange={(event) => {
                        setFillConsumption(event.target.value);
                        setIdempotencyKey(crypto.randomUUID());
                      }}
                      placeholder="Ej. volumen medido"
                      step="0.0001"
                      type="number"
                      value={fillConsumption}
                    />
                  )}
                </FormField>
              ) : null}
              <FormField label="Cliente (opcional)">
                {(props) => (
                  <select
                    {...props}
                    disabled={isSaving}
                    className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                    onChange={(event) => {
                      setCustomerId(event.target.value);
                      setIdempotencyKey(crypto.randomUUID());
                    }}
                    value={customerId}
                  >
                    <option value="">Venta sin cliente asociado</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>{customer.full_name}</option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField label="Forma de pago" required>
                {(props) => (
                  <select
                    {...props}
                    disabled={isSaving}
                    className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                    onChange={(event) => {
                      const next = event.target.value as PaymentMethod | "";
                      setPaymentMethod(next);
                      setIdempotencyKey(crypto.randomUUID());
                    }}
                    value={paymentMethod}
                  >
                    <option value="">Selecciona un método</option>
                    {enabledPaymentMethods.map((method) => (
                      <option key={method.method} value={method.method}>{method.label}</option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField label="Caja abierta" required>
                  {(props) => (
                    <select
                      {...props}
                      disabled={isSaving}
                      className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                      onChange={(event) => {
                        setCashSessionId(event.target.value);
                        setIdempotencyKey(crypto.randomUUID());
                      }}
                      value={cashSessionId}
                    >
                      <option value="">Selecciona una caja</option>
                      {cashSessions.map((session) => (
                        <option key={session.id} value={session.id}>{session.id.slice(0, 8)}</option>
                      ))}
                    </select>
                  )}
                </FormField>
              <FormField label="Notas (opcional)" className="sm:col-span-2">
                {(props) => (
                  <textarea
                    {...props}
                    disabled={isSaving}
                    className="min-h-20 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                    maxLength={1000}
                    onChange={(event) => {
                      setNotes(event.target.value);
                      setIdempotencyKey(crypto.randomUUID());
                    }}
                    value={notes}
                  />
                )}
              </FormField>
            </div>

            {stockShortages.length ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                Existencias insuficientes: {stockShortages.map((item) =>
                  `${item.name} (${formatQuantity(item.available)} disponibles, requiere ${formatQuantity(item.needed)} ${unitLabels[item.unit]})`,
                ).join("; ")}.
              </p>
            ) : null}

            {showFinancials ? (
              <div className="grid gap-3 sm:grid-cols-4">
                <Metric label="Costo estimado total" value={costEstimate === null ? "—" : formatCop(costEstimate)} />
                <Metric label="Precio total" value={formatCop(recipe.price_cop * (validCount ? count : 1))} />
                <Metric
                  label="Utilidad estimada"
                  value={costEstimate === null ? "—" : formatCop(recipe.price_cop * count - costEstimate)}
                />
                <Metric
                  label="Margen"
                  value={
                    costEstimate === null || recipe.price_cop === 0 || !validCount
                      ? "—"
                      : `${(((recipe.price_cop * count - costEstimate) / (recipe.price_cop * count)) * 100).toLocaleString("es-CO", { maximumFractionDigits: 1 })}%`
                  }
                />
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button disabled={isSaving} onClick={() => onOpenChange(false)} type="button" variant="outline">Cancelar</Button>
              <Button disabled={isSaving || stockShortages.length > 0 || !validCount || !hasEnabledPaymentMethod || !cashSessions.length} type="submit">
                {isSaving ? "Confirmando…" : "Confirmar fabricación y venta"}
              </Button>
            </div>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border px-3 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}
