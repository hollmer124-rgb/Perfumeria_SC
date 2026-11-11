import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { AlertTriangle, ArrowDownUp, Plus, SlidersHorizontal } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  SearchBox,
} from "@/features/inventory/components";
import {
  fetchInventoryCosts,
  fetchInventoryMovements,
  fetchMaterials,
  fetchPerfumes,
  fetchProducts,
  fetchSuppliers,
  getInventoryItemName,
  inventoryQueryKeys,
  movementLabel,
} from "@/features/inventory/data";
import { formatCop, formatQuantity } from "@/features/inventory/format";
import type {
  InventoryCost,
  InventoryMovement,
  Material,
  MaterialCategory,
  RetailProduct,
  Supplier,
} from "@/features/inventory/types";
import { useAuth } from "@/features/auth/use-auth";
import { supabase } from "@/lib/supabase";
import { notify } from "@/lib/notifications";
import { operationErrorMessage } from "@/lib/operation-error";

const materialSchema = z
  .object({
    name: z.string().trim().min(1, "Ingresa el nombre.").max(180),
    category: z.enum(["essence", "alcohol", "pheromone", "bottle", "other"]),
    base_unit: z.enum(["g", "ml", "unit", "dose"]),
    perfume_id: z.string(),
    supplier_id: z.string(),
    size_ml: z.string(),
    minimum_qty: z.string().regex(/^\d+([.]\d{1,4})?$/, "Ingresa una cantidad válida."),
    active: z.enum(["true", "false"]),
  })
  .superRefine((values, context) => {
    if (values.category === "essence" && !values.perfume_id) {
      context.addIssue({
        code: "custom",
        message: "Vincula la esencia con un perfume.",
        path: ["perfume_id"],
      });
    }
    if (values.category === "bottle" && !values.size_ml) {
      context.addIssue({
        code: "custom",
        message: "Selecciona la presentación del frasco.",
        path: ["size_ml"],
      });
    }
    if (
      values.category === "bottle" &&
      values.base_unit !== "unit"
    ) {
      context.addIssue({
        code: "custom",
        message: "Los frascos se controlan por unidades.",
        path: ["base_unit"],
      });
    }
    if (values.category !== "essence" && values.perfume_id) {
      context.addIssue({
        code: "custom",
        message: "Solo una esencia se vincula a un perfume.",
        path: ["perfume_id"],
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

type MaterialValues = z.infer<typeof materialSchema>;
type InventoryFilter = "all" | "materials" | "products" | "low";

const emptyMaterialValues: MaterialValues = {
  name: "",
  category: "other",
  base_unit: "unit",
  perfume_id: "",
  supplier_id: "",
  size_ml: "",
  minimum_qty: "0",
  active: "true",
};

function MaterialDialog({
  open,
  onOpenChange,
  material,
  perfumes,
  suppliers,
  onSave,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  material: Material | null;
  perfumes: { id: string; name: string; brand: string; active: boolean }[];
  suppliers: Supplier[];
  onSave: (values: MaterialValues) => Promise<void>;
  isSaving: boolean;
}) {
  const formValues = useMemo<MaterialValues>(
    () =>
      material
        ? {
            name: material.name,
            category: material.category,
            base_unit: material.base_unit,
            perfume_id: material.perfume_id ?? "",
            supplier_id: material.supplier_id ?? "",
            size_ml: material.size_ml ? String(material.size_ml) : "",
            minimum_qty: String(material.minimum_qty),
            active: String(material.active) as "true" | "false",
          }
        : emptyMaterialValues,
    [material],
  );
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<MaterialValues>({
    resolver: zodResolver(materialSchema),
    defaultValues: emptyMaterialValues,
    values: formValues,
  });
  const category = useWatch({ control, name: "category" });

  async function submit(values: MaterialValues) {
    try {
      await onSave(values);
      reset(emptyMaterialValues);
    } catch {
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {material ? "Editar material" : "Nuevo material"}
          </DialogTitle>
          <DialogDescription>
            Define la unidad base y el proveedor preferido. El stock y costo
            inicial se registran mediante una compra o ajuste trazable.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(submit)}>
          <FormField label="Nombre" error={errors.name?.message} required>
            {(props) => <Input {...props} {...register("name")} />}
          </FormField>
          <FormField label="Categoría" required>
            {(props) => (
              <select
                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                {...props}
                {...register("category")}
              >
                <option value="essence">Esencia</option>
                <option value="alcohol">Alcohol</option>
                <option value="pheromone">Feromonas</option>
                <option value="bottle">Frasco con atomizador</option>
                <option value="other">Otro material</option>
              </select>
            )}
          </FormField>
          <FormField label="Unidad base" required>
            {(props) => (
              <select
                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                disabled={category === "bottle"}
                {...props}
                {...register("base_unit")}
              >
                <option value="g">Gramos (g)</option>
                <option value="ml">Mililitros (ml)</option>
                <option value="unit">Unidades</option>
                <option value="dose">Dosis</option>
              </select>
            )}
          </FormField>
          {category === "essence" ? (
            <FormField
              label="Perfume vinculado"
              error={errors.perfume_id?.message}
              required
            >
              {(props) => (
                <select
                  className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                  {...props}
                  {...register("perfume_id")}
                >
                  <option value="">Selecciona un perfume</option>
                  {perfumes
                    .filter((perfume) => perfume.active)
                    .map((perfume) => (
                      <option key={perfume.id} value={perfume.id}>
                        {perfume.brand} · {perfume.name}
                      </option>
                    ))}
                </select>
              )}
            </FormField>
          ) : null}
          {category === "bottle" ? (
            <FormField label="Presentación del frasco" error={errors.size_ml?.message} required>
              {(props) => (
                <select
                  className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                  {...props}
                  {...register("size_ml")}
                >
                  <option value="">Selecciona una presentación</option>
                  {[30, 50, 60, 100].map((size) => (
                    <option key={size} value={size}>
                      {size} ml
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          ) : null}
          <FormField label="Proveedor preferido">
            {(props) => (
              <select
                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                {...props}
                {...register("supplier_id")}
              >
                <option value="">Sin proveedor preferido</option>
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
          <FormField label="Alerta de stock bajo" error={errors.minimum_qty?.message}>
            {(props) => (
              <Input
                inputMode="decimal"
                min="0"
                step="0.0001"
                type="number"
                {...props}
                {...register("minimum_qty")}
              />
            )}
          </FormField>
          {material ? (
            <FormField label="Estado">
              {(props) => (
                <select
                  className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                  {...props}
                  {...register("active")}
                >
                  <option value="true">Activo</option>
                  <option value="false">Inactivo</option>
                </select>
              )}
            </FormField>
          ) : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
              Cancelar
            </Button>
            <Button disabled={isSaving} type="submit">
              {isSaving ? "Guardando…" : "Guardar material"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const adjustmentSchema = z
  .object({
    quantity_delta: z
      .string()
      .regex(/^-?\d+([.]\d{1,4})?$/, "Usa una cantidad decimal válida distinta de cero.")
      .refine((value) => Number(value) !== 0, "La cantidad no puede ser cero."),
    reason: z.string().trim().min(1, "Explica el motivo.").max(240),
    inbound_unit_cost_cop: z.string(),
  })
  .refine(
    (values) =>
      Number(values.quantity_delta) <= 0 ||
      /^\d+$/.test(values.inbound_unit_cost_cop),
    {
      message: "El costo unitario de entrada debe ser un entero en COP.",
      path: ["inbound_unit_cost_cop"],
    },
  );

type AdjustmentValues = z.infer<typeof adjustmentSchema>;

function AdjustmentDialog({
  item,
  onOpenChange,
  onSave,
  isSaving,
}: {
  item: { id: string; name: string; unit: string; kind: "material" | "retail_product" } | null;
  onOpenChange: (open: boolean) => void;
  onSave: (values: AdjustmentValues) => Promise<void>;
  isSaving: boolean;
}) {
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<AdjustmentValues>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: {
      quantity_delta: "",
      reason: "",
      inbound_unit_cost_cop: "",
    },
  });
  const quantity = useWatch({ control, name: "quantity_delta" });

  async function submit(values: AdjustmentValues) {
    try {
      await onSave(values);
      reset();
    } catch {
      return;
    }
  }

  return (
    <Dialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajustar existencia</DialogTitle>
          <DialogDescription>
            {item
              ? `${item.name} · existencia actualizada con un movimiento auditable.`
              : "Cada ajuste queda registrado en el historial."}
          </DialogDescription>
        </DialogHeader>
        {item ? (
          <form className="space-y-4" onSubmit={handleSubmit(submit)}>
            <FormField
              label={`Cambio de cantidad (${item.unit})`}
              description="Usa positivo para una entrada y negativo para una salida."
              error={errors.quantity_delta?.message}
              required
            >
              {(props) => (
                <Input
                  inputMode="decimal"
                  step={item.kind === "retail_product" ? "1" : "0.0001"}
                  type="number"
                  {...props}
                  {...register("quantity_delta")}
                />
              )}
            </FormField>
            {Number(quantity) > 0 ? (
              <FormField
                label="Costo unitario de entrada (COP)"
                error={errors.inbound_unit_cost_cop?.message}
                required
              >
                {(props) => (
                  <Input
                    inputMode="numeric"
                    min="0"
                    type="number"
                    {...props}
                    {...register("inbound_unit_cost_cop")}
                  />
                )}
              </FormField>
            ) : null}
            <FormField label="Motivo" error={errors.reason?.message} required>
              {(props) => (
                <Input
                  placeholder="Ej. conteo físico, pérdida, corrección"
                  {...props}
                  {...register("reason")}
                />
              )}
            </FormField>
            <div className="flex justify-end gap-2">
              <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
                Cancelar
              </Button>
              <Button disabled={isSaving} type="submit">
                {isSaving ? "Registrando…" : "Guardar ajuste"}
              </Button>
            </div>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function categoryLabel(category: MaterialCategory): string {
  const labels: Record<MaterialCategory, string> = {
    essence: "Esencia",
    alcohol: "Alcohol",
    pheromone: "Feromonas",
    bottle: "Frasco",
    other: "Otro",
  };
  return labels[category];
}

function MovementHistory({
  movements,
  products,
  materials,
  loading,
  error,
  onRetry,
}: {
  movements: InventoryMovement[];
  products: RetailProduct[];
  materials: Material[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowDownUp aria-hidden="true" size={16} className="text-gold" />
          Historial de movimientos
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Últimos 100 movimientos. Los costos solo están disponibles para el
          administrador.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <LoadingState label="Cargando movimientos…" />
        ) : error ? (
          <ErrorState onRetry={onRetry} />
        ) : movements.length === 0 ? (
          <EmptyState
            description="Las entradas, ventas y ajustes aparecerán al registrarse."
            title="Aún no hay movimientos"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Artículo</TableHead>
                <TableHead>Movimiento</TableHead>
                <TableHead>Cantidad</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((movement) => {
                const material = movement.material_id
                  ? materials.find((item) => item.id === movement.material_id)
                  : null;
                return (
                  <TableRow key={movement.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Intl.DateTimeFormat("es-CO", {
                        dateStyle: "short",
                        timeStyle: "short",
                        timeZone: "America/Bogota",
                      }).format(new Date(movement.created_at))}
                    </TableCell>
                    <TableCell>
                      {getInventoryItemName(movement, products, materials)}
                    </TableCell>
                    <TableCell>{movementLabel(movement.movement_type)}</TableCell>
                    <TableCell
                      className={
                        movement.quantity_delta < 0
                          ? "font-medium text-red-700"
                          : "font-medium text-green-800"
                      }
                    >
                      {movement.quantity_delta > 0 ? "+" : ""}
                      {formatQuantity(movement.quantity_delta)}{" "}
                      {material?.base_unit ??
                        (movement.retail_product_id ? "unit" : "")}
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-xs text-muted-foreground">
                      {movement.reason ?? "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function InventoryPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [adjustingItem, setAdjustingItem] = useState<{
    id: string;
    name: string;
    unit: string;
    kind: "material" | "retail_product";
  } | null>(null);
  const products = useQuery({
    queryKey: inventoryQueryKeys.products,
    queryFn: fetchProducts,
  });
  const materials = useQuery({
    queryKey: inventoryQueryKeys.materials,
    queryFn: fetchMaterials,
  });
  const perfumes = useQuery({
    queryKey: inventoryQueryKeys.perfumes,
    queryFn: fetchPerfumes,
  });
  const suppliers = useQuery({
    queryKey: inventoryQueryKeys.suppliers,
    queryFn: fetchSuppliers,
    enabled: isAdmin,
  });
  const costs = useQuery({
    queryKey: inventoryQueryKeys.costs,
    queryFn: fetchInventoryCosts,
    enabled: isAdmin,
  });
  const movements = useQuery({
    queryKey: inventoryQueryKeys.movements,
    queryFn: fetchInventoryMovements,
  });

  const refreshInventory = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.products }),
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.materials }),
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.costs }),
      queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.movements }),
    ]);
  };

  const saveMaterial = useMutation({
    mutationFn: async (values: MaterialValues) => {
      if (!supabase) throw new Error("Supabase no está conectado.");
      const payload = {
        name: values.name,
        category: values.category,
        base_unit:
          values.category === "bottle" ? "unit" : values.base_unit,
        perfume_id: values.category === "essence" ? values.perfume_id : null,
        supplier_id: values.supplier_id || null,
        size_ml:
          values.category === "bottle" ? Number(values.size_ml) : null,
        minimum_qty: Number(values.minimum_qty),
        active: values.active !== "false",
      };
      const request = editingMaterial
        ? supabase
            .from("materials")
            .update(payload)
            .eq("id", editingMaterial.id)
            .select("id")
            .single()
        : supabase.from("materials").insert(payload).select("id").single();
      const { error } = await request;
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.materials });
      setMaterialDialogOpen(false);
      setEditingMaterial(null);
      notify.success("Material guardado.");
    },
    onError: (error) => notify.error(operationErrorMessage(error, "No se pudo guardar el material.", "Material save failed")),
  });

  const adjustInventory = useMutation({
    mutationFn: async (values: AdjustmentValues) => {
      if (!supabase || !adjustingItem) {
        throw new Error("Selecciona un artículo y verifica la conexión.");
      }
      const { data, error } = await supabase.rpc("adjust_inventory", {
        p_material_id:
          adjustingItem.kind === "material" ? adjustingItem.id : null,
        p_retail_product_id:
          adjustingItem.kind === "retail_product" ? adjustingItem.id : null,
        p_quantity_delta: Number(values.quantity_delta),
        p_reason: values.reason,
        p_inbound_unit_cost_cop:
          Number(values.quantity_delta) > 0
            ? Number(values.inbound_unit_cost_cop)
            : null,
      });
      if (error) throw error;
      if (!data) throw new Error("Supabase no confirmó el ajuste de inventario.");
    },
    onSuccess: async () => {
      await refreshInventory();
      setAdjustingItem(null);
      notify.success("Ajuste de inventario registrado.");
    },
    onError: (error) => notify.error(operationErrorMessage(error, "No se pudo ajustar el inventario.", "Inventory adjustment failed")),
  });

  const costMap = useMemo(
    () =>
      new Map(
        (costs.data ?? []).map((cost: InventoryCost) => [
          `${cost.item_kind}:${cost.item_id}`,
          cost.avg_unit_cost_cop,
        ]),
      ),
    [costs.data],
  );
  const combined = useMemo(
    () => [
      ...(materials.data ?? []).map((material) => ({
        id: material.id,
        kind: "material" as const,
        name: material.name,
        brand: material.perfume_id
          ? perfumes.data?.find((perfume) => perfume.id === material.perfume_id)
              ?.brand
          : undefined,
        category: material.category,
        size_ml: material.size_ml,
        unit: material.base_unit,
        quantity: material.on_hand_qty,
        minimum: material.minimum_qty,
        active: material.active,
        source: material,
      })),
      ...(products.data ?? []).map((product) => ({
        id: product.id,
        kind: "retail_product" as const,
        name: product.name,
        brand: product.brand,
        category: product.product_type,
        size_ml: product.size_ml,
        unit: "unit",
        quantity: product.stock_qty,
        minimum: product.minimum_qty,
        active: product.active,
        source: product,
      })),
    ],
    [materials.data, perfumes.data, products.data],
  );
  const lowStockItems = combined.filter(
    (item) => item.active && item.minimum > 0 && item.quantity <= item.minimum,
  );
  const visible = combined.filter((item) => {
    const matchesText =
      `${item.name} ${item.brand ?? ""}`
        .toLocaleLowerCase("es-CO")
        .includes(search.toLocaleLowerCase("es-CO"));
    const matchesFilter =
      filter === "all" ||
      (filter === "materials" && item.kind === "material") ||
      (filter === "products" && item.kind === "retail_product") ||
      (filter === "low" &&
        item.active &&
        item.minimum > 0 &&
        item.quantity <= item.minimum);
    return matchesText && matchesFilter;
  });
  const loading =
    products.isLoading ||
    materials.isLoading ||
    perfumes.isLoading ||
    (isAdmin && (suppliers.isLoading || costs.isLoading));
  const loadError =
    products.isError ||
    materials.isError ||
    perfumes.isError ||
    movements.isError ||
    (isAdmin && (suppliers.isError || costs.isError));

  return (
    <div className="space-y-7">
      <PageHeading
        action={
          isAdmin ? (
            <Button
              onClick={() => {
                setEditingMaterial(null);
                setMaterialDialogOpen(true);
              }}
            >
              <Plus aria-hidden="true" size={16} />
              Nuevo material
            </Button>
          ) : null
        }
        description="Existencias de productos terminados y materias primas, con alertas y un historial verificable de cada movimiento."
        eyebrow="Existencias y trazabilidad"
        title="Inventario"
      />
      {lowStockItems.length ? (
        <Card className="border-amber-300 bg-amber-50/70">
          <CardContent className="flex items-start gap-3 pt-5">
            <AlertTriangle aria-hidden="true" className="mt-0.5 text-amber-800" size={18} />
            <div>
              <p className="text-sm font-semibold text-amber-950">
                {lowStockItems.length} artículo(s) en stock bajo
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-900">
                {lowStockItems
                  .slice(0, 5)
                  .map((item) => item.name)
                  .join(" · ")}
                {lowStockItems.length > 5 ? " · y otros" : ""}
              </p>
            </div>
            <Button
              className="ml-auto shrink-0"
              onClick={() => setFilter("low")}
              size="sm"
              variant="outline"
            >
              Ver
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <InventoryMetric label="Productos terminados" value={(products.data ?? []).filter((item) => item.active).length} />
        <InventoryMetric label="Materias primas" value={(materials.data ?? []).filter((item) => item.active).length} />
        <InventoryMetric label="Alertas de stock bajo" value={lowStockItems.length} />
      </div>
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal aria-hidden="true" size={16} className="text-gold" />
            Existencias
          </CardTitle>
          <div className="flex flex-col gap-2 sm:flex-row">
            <SearchBox
              onChange={setSearch}
              placeholder="Buscar artículos"
              value={search}
            />
            <select
              aria-label="Filtrar inventario"
              className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
              onChange={(event) => setFilter(event.target.value as InventoryFilter)}
              value={filter}
            >
              <option value="all">Todos</option>
              <option value="materials">Materias primas</option>
              <option value="products">Productos terminados</option>
              <option value="low">Stock bajo</option>
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <LoadingState />
          ) : loadError ? (
            <ErrorState
              onRetry={() => {
                void products.refetch();
                void materials.refetch();
                void perfumes.refetch();
                void movements.refetch();
                if (isAdmin) {
                  void suppliers.refetch();
                  void costs.refetch();
                }
              }}
            />
          ) : visible.length === 0 ? (
            <EmptyState
              description="Crea materiales o cambia los filtros de búsqueda."
              title="No hay artículos para mostrar"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Artículo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Existencia</TableHead>
                  <TableHead>Mínimo</TableHead>
                  {isAdmin ? <TableHead>Costo promedio</TableHead> : null}
                  <TableHead>Estado</TableHead>
                  {isAdmin ? <TableHead className="text-right">Acciones</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((item) => {
                  const low =
                    item.active && item.minimum > 0 && item.quantity <= item.minimum;
                  return (
                    <TableRow key={`${item.kind}:${item.id}`}>
                      <TableCell>
                        <div className="font-medium">{item.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.kind === "material"
                            ? `${item.brand ? `${item.brand} · ` : ""}${item.unit}${item.size_ml ? ` · ${item.size_ml} ml` : ""}`
                            : `${item.brand ?? ""}${item.size_ml ? ` · ${item.size_ml} ml` : ""}`}
                        </div>
                      </TableCell>
                      <TableCell>
                        {item.kind === "material"
                          ? categoryLabel(item.category as MaterialCategory)
                          : item.category === "original"
                            ? "Original"
                            : "1.1"}
                      </TableCell>
                      <TableCell className={low ? "font-semibold text-red-700" : ""}>
                        {formatQuantity(item.quantity)} {item.unit}
                      </TableCell>
                      <TableCell>
                        {formatQuantity(item.minimum)} {item.unit}
                      </TableCell>
                      {isAdmin ? (
                        <TableCell>
                          {formatCop(
                            costMap.get(`${item.kind}:${item.id}`) ?? 0,
                          )}
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <span
                          className={
                            item.active
                              ? low
                                ? "rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-900"
                                : "rounded-full bg-green-50 px-2 py-1 text-xs text-green-800"
                              : "rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"
                          }
                        >
                          {!item.active ? "Inactivo" : low ? "Stock bajo" : "Disponible"}
                        </span>
                      </TableCell>
                      {isAdmin ? (
                        <TableCell className="text-right">
                          <div className="inline-flex gap-2">
                            {item.kind === "material" ? (
                              <Button
                                onClick={() => {
                                  setEditingMaterial(item.source as Material);
                                  setMaterialDialogOpen(true);
                                }}
                                size="sm"
                                variant="outline"
                              >
                                Editar
                              </Button>
                            ) : null}
                            {item.active ? (
                              <Button
                                onClick={() =>
                                  setAdjustingItem({
                                    id: item.id,
                                    name: item.name,
                                    unit: item.unit,
                                    kind: item.kind,
                                  })
                                }
                                size="sm"
                                variant="outline"
                              >
                                Ajustar
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <MovementHistory
        error={movements.isError}
        loading={movements.isLoading}
        materials={materials.data ?? []}
        movements={movements.data ?? []}
        onRetry={() => void movements.refetch()}
        products={products.data ?? []}
      />
      <MaterialDialog
        isSaving={saveMaterial.isPending}
        material={editingMaterial}
        onOpenChange={(open) => {
          setMaterialDialogOpen(open);
          if (!open) setEditingMaterial(null);
        }}
        onSave={(values) => saveMaterial.mutateAsync(values)}
        open={materialDialogOpen}
        perfumes={perfumes.data ?? []}
        suppliers={suppliers.data ?? []}
      />
      <AdjustmentDialog
        isSaving={adjustInventory.isPending}
        item={adjustingItem}
        onOpenChange={(open) => {
          if (!open) setAdjustingItem(null);
        }}
        onSave={(values) => adjustInventory.mutateAsync(values)}
      />
    </div>
  );
}

function InventoryMetric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        <CardTitle className="font-serif text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
