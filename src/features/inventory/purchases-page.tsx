import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Plus,
  ReceiptText,
  X,
} from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeading,
} from "@/features/inventory/components";
import {
  fetchInventoryCosts,
  fetchMaterials,
  fetchProducts,
  fetchPurchases,
  fetchSuppliers,
  inventoryQueryKeys,
} from "@/features/inventory/data";
import {
  formatCop,
  formatQuantity,
  localDateInputValue,
} from "@/features/inventory/format";
import type {
  InventoryCost,
  Material,
  Purchase,
  PurchaseStatus,
  RetailProduct,
  Supplier,
} from "@/features/inventory/types";
import { supabase } from "@/lib/supabase";
import { notify } from "@/lib/notifications";

type PurchaseItemChoice = {
  key: string;
  type: "material" | "retail_product";
  id: string;
  name: string;
  unit: string;
  stock: number;
  defaultCost: number;
};

interface DraftLine {
  key: string;
  itemKey: string;
  quantity: string;
  unit_cost_cop: string;
}

const purchaseSchema = z.object({
  supplier_id: z.string().uuid("Selecciona un proveedor."),
  purchased_at: z.string().min(1, "Selecciona la fecha de compra."),
  notes: z.string().max(1000, "Las notas no pueden superar 1000 caracteres."),
});

function PurchaseDialog({
  open,
  onOpenChange,
  suppliers,
  choices,
  isSaving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suppliers: Supplier[];
  choices: PurchaseItemChoice[];
  isSaving: boolean;
  onSave: (purchase: {
    supplier_id: string;
    purchased_at: string;
    notes: string;
    items: { type: "material" | "retail_product"; id: string; quantity: number; unit_cost_cop: number }[];
  }) => Promise<void>;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [purchasedAt, setPurchasedAt] = useState(localDateInputValue());
  const [notes, setNotes] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const choiceByKey = useMemo(
    () => new Map(choices.map((choice) => [choice.key, choice])),
    [choices],
  );
  const selectedChoice = choiceByKey.get(selectedItem);
  const usedKeys = new Set(lines.map((line) => line.itemKey));
  const estimatedTotal = lines.reduce(
    (total, line) =>
      total + Math.round(Number(line.quantity) * Number(line.unit_cost_cop)),
    0,
  );

  function addLine() {
    setFormError(null);
    if (!selectedChoice) {
      setFormError("Selecciona un producto o material.");
      return;
    }
    const parsedQuantity = Number(quantity);
    const parsedCost = Number(unitCost);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setFormError("La cantidad debe ser mayor que cero.");
      return;
    }
    if (
      selectedChoice.type === "retail_product" &&
      !Number.isInteger(parsedQuantity)
    ) {
      setFormError("Los productos terminados se compran por unidades completas.");
      return;
    }
    if (
      !/^\d+$/.test(unitCost) ||
      !Number.isSafeInteger(parsedCost) ||
      parsedCost < 0
    ) {
      setFormError("El costo unitario debe ser un entero no negativo en COP.");
      return;
    }
    if (usedKeys.has(selectedChoice.key)) {
      setFormError("Ese artículo ya está en la compra.");
      return;
    }

    setLines((current) => [
      ...current,
      {
        key: `${selectedChoice.key}:${crypto.randomUUID()}`,
        itemKey: selectedChoice.key,
        quantity,
        unit_cost_cop: unitCost,
      },
    ]);
    setSelectedItem("");
    setQuantity("");
    setUnitCost("");
  }

  async function submitPurchase() {
    setFormError(null);
    const header = purchaseSchema.safeParse({
      supplier_id: supplierId,
      purchased_at: purchasedAt,
      notes,
    });
    if (!header.success) {
      setFormError(header.error.issues[0]?.message ?? "Revisa los datos de compra.");
      return;
    }
    if (lines.length === 0) {
      setFormError("Agrega al menos un artículo a la compra.");
      return;
    }
    const parsedItems: {
      type: "material" | "retail_product";
      id: string;
      quantity: number;
      unit_cost_cop: number;
    }[] = [];
    for (const line of lines) {
      const choice = choiceByKey.get(line.itemKey);
      if (!choice) {
        setFormError("Un artículo ya no está disponible. Actualiza la lista e inténtalo de nuevo.");
        return;
      }
      parsedItems.push({
        type: choice.type,
        id: choice.id,
        quantity: Number(line.quantity),
        unit_cost_cop: Number(line.unit_cost_cop),
      });
    }
    try {
      await onSave({
        ...header.data,
        notes: header.data.notes,
        items: parsedItems,
      });
      setSupplierId("");
      setPurchasedAt(localDateInputValue());
      setNotes("");
      setLines([]);
    } catch {
      return;
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSaving) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Registrar compra</DialogTitle>
          <DialogDescription>
            La compra se guarda como borrador. Al recibirla se actualizarán
            existencias y costos promedio en una transacción.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Proveedor" required>
            {(props) => (
              <select
                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                {...props}
                onChange={(event) => setSupplierId(event.target.value)}
                value={supplierId}
              >
                <option value="">Selecciona un proveedor</option>
                {suppliers
                  .filter((supplier) => supplier.active)
                  .map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
              </select>
            )}
          </FormField>
          <FormField label="Fecha de compra" required>
            {(props) => (
              <Input
                max={localDateInputValue()}
                type="date"
                {...props}
                onChange={(event) => setPurchasedAt(event.target.value)}
                value={purchasedAt}
              />
            )}
          </FormField>
          <FormField className="sm:col-span-2" label="Notas (opcional)">
            {(props) => (
              <Textarea
                {...props}
                onChange={(event) => setNotes(event.target.value)}
                value={notes}
              />
            )}
          </FormField>
        </div>
        <section className="space-y-3 rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold">Artículos de la compra</h3>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_160px_auto]">
            <FormField label="Artículo">
              {(props) => (
                <select
                  className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                  {...props}
                  onChange={(event) => {
                    const key = event.target.value;
                    setSelectedItem(key);
                    setUnitCost(
                      String(choiceByKey.get(key)?.defaultCost ?? 0),
                    );
                  }}
                  value={selectedItem}
                >
                  <option value="">Selecciona un artículo</option>
                  {choices.map((choice) => (
                    <option
                      disabled={usedKeys.has(choice.key)}
                      key={choice.key}
                      value={choice.key}
                    >
                      {choice.name} · {choice.unit} · Stock{" "}
                      {formatQuantity(choice.stock)}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label="Cantidad">
              {(props) => (
                <Input
                  inputMode="decimal"
                  min="0.0001"
                  step={selectedChoice?.type === "retail_product" ? "1" : "0.0001"}
                  type="number"
                  {...props}
                  onChange={(event) => setQuantity(event.target.value)}
                  value={quantity}
                />
              )}
            </FormField>
            <FormField label="Costo unitario (COP)">
              {(props) => (
                <Input
                  inputMode="numeric"
                  min="0"
                  step="1"
                  type="number"
                  {...props}
                  onChange={(event) => setUnitCost(event.target.value)}
                  value={unitCost}
                />
              )}
            </FormField>
            <Button className="self-end" onClick={addLine} type="button" variant="outline">
              <Plus aria-hidden="true" size={15} />
              Añadir
            </Button>
          </div>
          {lines.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Artículo</TableHead>
                    <TableHead>Cantidad</TableHead>
                    <TableHead>Costo unitario</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => {
                    const choice = choiceByKey.get(line.itemKey);
                    return (
                      <TableRow key={line.key}>
                        <TableCell>
                          {choice?.name ?? "Artículo"}{" "}
                          <span className="text-xs text-muted-foreground">
                            ({choice?.unit})
                          </span>
                        </TableCell>
                        <TableCell>{formatQuantity(Number(line.quantity))}</TableCell>
                        <TableCell>{formatCop(Number(line.unit_cost_cop))}</TableCell>
                        <TableCell>
                          {formatCop(
                            Math.round(
                              Number(line.quantity) * Number(line.unit_cost_cop),
                            ),
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            aria-label={`Quitar ${choice?.name ?? "artículo"}`}
                            onClick={() =>
                              setLines((current) =>
                                current.filter((entry) => entry.key !== line.key),
                              )
                            }
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <X aria-hidden="true" size={15} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
              Añade los materiales o productos terminados recibidos.
            </p>
          )}
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-medium">Total estimado</span>
            <span className="font-semibold">{formatCop(estimatedTotal)}</span>
          </div>
        </section>
        {formError ? (
          <p className="text-sm text-red-700" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            disabled={isSaving}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancelar
          </Button>
          <Button disabled={isSaving} onClick={() => void submitPurchase()}>
            {isSaving ? "Guardando…" : "Guardar borrador"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const statusLabels: Record<PurchaseStatus, string> = {
  draft: "Borrador",
  received: "Recibida",
  cancelled: "Cancelada",
};

function purchaseTotal(purchase: Purchase): number {
  return purchase.total_cop || purchase.purchase_items.reduce(
    (total, item) => total + item.line_total_cop,
    0,
  );
}

export function PurchasesPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const purchases = useQuery({
    queryKey: inventoryQueryKeys.purchases,
    queryFn: fetchPurchases,
  });
  const suppliers = useQuery({
    queryKey: inventoryQueryKeys.suppliers,
    queryFn: fetchSuppliers,
  });
  const products = useQuery({
    queryKey: inventoryQueryKeys.products,
    queryFn: fetchProducts,
  });
  const materials = useQuery({
    queryKey: inventoryQueryKeys.materials,
    queryFn: fetchMaterials,
  });
  const costs = useQuery({
    queryKey: inventoryQueryKeys.costs,
    queryFn: fetchInventoryCosts,
  });

  const choices = useMemo<PurchaseItemChoice[]>(() => {
    const costMap = new Map(
      (costs.data ?? []).map((cost: InventoryCost) => [
        `${cost.item_kind}:${cost.item_id}`,
        cost.avg_unit_cost_cop,
      ]),
    );
    return [
      ...(materials.data ?? [])
        .filter((material) => material.active)
        .map((material: Material) => ({
          key: `material:${material.id}`,
          type: "material" as const,
          id: material.id,
          name: material.name,
          unit: material.base_unit,
          stock: material.on_hand_qty,
          defaultCost: costMap.get(`material:${material.id}`) ?? 0,
        })),
      ...(products.data ?? [])
        .filter((product) => product.active)
        .map((product: RetailProduct) => ({
          key: `retail_product:${product.id}`,
          type: "retail_product" as const,
          id: product.id,
          name: `${product.brand} · ${product.name} (${product.product_type})`,
          unit: "unit",
          stock: product.stock_qty,
          defaultCost: costMap.get(`retail_product:${product.id}`) ?? 0,
        })),
    ];
  }, [costs.data, materials.data, products.data]);

  const refreshAfterPurchase = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.purchases }),
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.products }),
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.materials }),
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.costs }),
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.movements }),
    ]);
  };

  const createPurchase = useMutation({
    mutationFn: async (purchase: {
      supplier_id: string;
      purchased_at: string;
      notes: string;
      items: {
        type: "material" | "retail_product";
        id: string;
        quantity: number;
        unit_cost_cop: number;
      }[];
    }) => {
      if (!supabase) throw new Error("Supabase no está conectado.");
      const { data, error } = await supabase.rpc("create_purchase", {
        p_supplier_id: purchase.supplier_id,
        p_purchased_at: purchase.purchased_at,
        p_items: purchase.items,
        p_notes: purchase.notes || null,
      });
      if (error) throw error;
      if (!data) throw new Error("Supabase no confirmó la compra.");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.purchases });
      setDialogOpen(false);
      notify.success("Compra guardada como borrador. Confirma la recepción para actualizar existencias.");
    },
    onError: (error) => notify.error(error.message),
  });

  const receivePurchase = useMutation({
    mutationFn: async (purchaseId: string) => {
      if (!supabase) throw new Error("Supabase no está conectado.");
      const { data, error } = await supabase.rpc("receive_purchase", {
        p_purchase_id: purchaseId,
      });
      if (error) throw error;
      if (data === null) throw new Error("Supabase no confirmó la recepción.");
    },
    onSuccess: async () => {
      await refreshAfterPurchase();
      notify.success("Compra recibida; existencias y costos promedio actualizados.");
    },
    onError: (error) => notify.error(error.message),
  });

  const cancelPurchase = useMutation({
    mutationFn: async (purchaseId: string) => {
      if (!supabase) throw new Error("Supabase no está conectado.");
      const { error } = await supabase.rpc("cancel_purchase", {
        p_purchase_id: purchaseId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.purchases });
      notify.success("Borrador de compra cancelado; se conserva en el historial.");
    },
    onError: (error) => notify.error(error.message),
  });

  const loading =
    purchases.isLoading ||
    suppliers.isLoading ||
    products.isLoading ||
    materials.isLoading ||
    costs.isLoading;
  const hasError =
    purchases.isError ||
    suppliers.isError ||
    products.isError ||
    materials.isError ||
    costs.isError;
  const drafts = (purchases.data ?? []).filter((item) => item.status === "draft").length;
  const received = (purchases.data ?? []).filter((item) => item.status === "received").length;
  const totalReceived = (purchases.data ?? [])
    .filter((item) => item.status === "received")
    .reduce((sum, item) => sum + item.total_cop, 0);

  return (
    <div className="space-y-7">
      <PageHeading
        action={
          <Button
            onClick={() => setDialogOpen(true)}
            disabled={
              suppliers.isLoading ||
              products.isLoading ||
              materials.isLoading ||
              suppliers.isError ||
              products.isError ||
              materials.isError
            }
          >
            <Plus aria-hidden="true" size={16} />
            Registrar compra
          </Button>
        }
        description="Registra compras a proveedores. Al confirmar la recepción, los movimientos y el costo promedio ponderado se actualizan de forma transaccional."
        eyebrow="Abastecimiento"
        title="Compras"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <PurchaseMetric label="Borradores pendientes" value={drafts} />
        <PurchaseMetric label="Compras recibidas" value={received} />
        <PurchaseMetric label="Total recibido" value={formatCop(totalReceived)} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ReceiptText aria-hidden="true" className="text-gold" size={17} />
            Historial de compras
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <LoadingState />
          ) : hasError ? (
            <ErrorState
              onRetry={() => {
                void purchases.refetch();
                void suppliers.refetch();
                void products.refetch();
                void materials.refetch();
                void costs.refetch();
              }}
            />
          ) : (purchases.data ?? []).length === 0 ? (
            <EmptyState
              description="Las compras se conservarán aquí como borradores, recibidas o canceladas."
              title="Todavía no hay compras"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead />
                  <TableHead>Fecha</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Artículos</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(purchases.data ?? []).map((purchase) => (
                  <Fragment key={purchase.id}>
                    <TableRow>
                      <TableCell>
                        <Button
                          aria-label={
                            expanded === purchase.id
                              ? "Ocultar detalle"
                              : "Ver detalle"
                          }
                          onClick={() =>
                            setExpanded(
                              expanded === purchase.id ? null : purchase.id,
                            )
                          }
                          size="icon-sm"
                          variant="ghost"
                        >
                          {expanded === purchase.id ? (
                            <ChevronDown aria-hidden="true" size={15} />
                          ) : (
                            <ChevronRight aria-hidden="true" size={15} />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {new Intl.DateTimeFormat("es-CO", {
                          dateStyle: "medium",
                          timeZone: "America/Bogota",
                        }).format(new Date(purchase.purchased_at))}
                      </TableCell>
                      <TableCell>{purchase.suppliers?.name ?? "Proveedor"}</TableCell>
                      <TableCell>{purchase.purchase_items.length}</TableCell>
                      <TableCell>{formatCop(purchaseTotal(purchase))}</TableCell>
                      <TableCell>
                        <span className="rounded-full bg-muted px-2 py-1 text-xs">
                          {statusLabels[purchase.status]}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {purchase.status === "draft" ? (
                          <div className="inline-flex gap-2">
                            <Button
                              disabled={
                                receivePurchase.isPending ||
                                purchase.purchase_items.length === 0
                              }
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "¿Confirmas que recibiste estos artículos? Se actualizarán existencias y costos promedio.",
                                  )
                                ) {
                                  receivePurchase.mutate(purchase.id);
                                }
                              }}
                              size="sm"
                            >
                              <BadgeCheck aria-hidden="true" size={14} />
                              Recibir
                            </Button>
                            <Button
                              disabled={cancelPurchase.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "¿Cancelar este borrador? Quedará en el historial y no cambiará el inventario.",
                                  )
                                ) {
                                  cancelPurchase.mutate(purchase.id);
                                }
                              }}
                              size="sm"
                              variant="outline"
                            >
                              Cancelar
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {purchase.received_at
                              ? `Recibida ${new Intl.DateTimeFormat("es-CO", {
                                  dateStyle: "short",
                                  timeZone: "America/Bogota",
                                }).format(new Date(purchase.received_at))}`
                              : "Sin cambios"}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                    {expanded === purchase.id ? (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-background px-6 py-4">
                          {purchase.notes ? (
                            <p className="mb-3 text-xs text-muted-foreground">
                              {purchase.notes}
                            </p>
                          ) : null}
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Artículo</TableHead>
                                <TableHead>Unidad</TableHead>
                                <TableHead>Cantidad</TableHead>
                                <TableHead>Costo unitario</TableHead>
                                <TableHead>Total</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {purchase.purchase_items.map((line) => (
                                <TableRow key={line.id}>
                                  <TableCell>{line.item_name_snapshot}</TableCell>
                                  <TableCell>{line.unit_snapshot}</TableCell>
                                  <TableCell>{formatQuantity(line.quantity)}</TableCell>
                                  <TableCell>{formatCop(line.unit_cost_cop)}</TableCell>
                                  <TableCell>{formatCop(line.line_total_cop)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <aside className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-xs leading-5 text-muted-foreground">
        <ClipboardList aria-hidden="true" className="mt-0.5 shrink-0 text-gold" size={16} />
        <p>
          Al recibir una compra, cada línea genera un movimiento de entrada con
          su costo histórico y actualiza el costo promedio ponderado. No se
          puede eliminar una compra ni sus artículos cuando ya están vinculados
          a movimientos.
        </p>
      </aside>
      <PurchaseDialog
        choices={choices}
        isSaving={createPurchase.isPending}
        onOpenChange={setDialogOpen}
        onSave={(purchase) => createPurchase.mutateAsync(purchase)}
        open={dialogOpen}
        suppliers={suppliers.data ?? []}
      />
    </div>
  );
}

function PurchaseMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        <CardTitle className="font-serif text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
