import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Pencil, Plus, Search, ShieldCheck } from "lucide-react";
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
} from "@/features/inventory/components";
import {
  fetchInventoryCosts,
  fetchProducts,
  fetchSuppliers,
  inventoryQueryKeys,
} from "@/features/inventory/data";
import { formatCop, formatQuantity } from "@/features/inventory/format";
import type {
  InventoryCost,
  RetailProduct,
  Supplier,
} from "@/features/inventory/types";
import { supabase } from "@/lib/supabase";
import { notify } from "@/lib/notifications";

const productSchema = z.object({
  name: z.string().trim().min(1, "Ingresa el nombre.").max(180),
  brand: z.string().trim().min(1, "Ingresa la marca.").max(120),
  product_type: z.enum(["original", "1.1"]),
  sku: z.string().trim().min(1, "Ingresa el SKU.").max(80),
  size_ml: z.enum(["30", "50", "60", "100"]),
  price_cop: z.string().regex(/^\d+$/, "Ingresa un precio entero en COP."),
  minimum_qty: z.string().regex(/^\d+$/, "Ingresa un mínimo entero."),
  supplier_id: z.string().uuid("Selecciona un proveedor."),
  active: z.enum(["true", "false"]),
});

type ProductValues = z.infer<typeof productSchema>;
type ProductFilter = "all" | "original" | "1.1" | "low";

const emptyValues: ProductValues = {
  name: "",
  brand: "",
  product_type: "original",
  sku: "",
  size_ml: "30",
  price_cop: "",
  minimum_qty: "0",
  supplier_id: "",
  active: "true",
};

function ProductDialog({
  open,
  onOpenChange,
  suppliers,
  product,
  onSave,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suppliers: Supplier[];
  product: RetailProduct | null;
  onSave: (values: ProductValues) => Promise<void>;
  isSaving: boolean;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ProductValues>({
    resolver: zodResolver(productSchema),
    defaultValues: emptyValues,
    values: product
      ? {
          name: product.name,
          brand: product.brand,
          product_type: product.product_type,
          sku: product.sku,
          size_ml: String(product.size_ml ?? 30) as ProductValues["size_ml"],
          price_cop: String(product.price_cop),
          minimum_qty: String(product.minimum_qty),
          supplier_id: product.supplier_id ?? "",
          active: String(product.active) as "true" | "false",
        }
      : emptyValues,
  });

  async function submit(values: ProductValues) {
    try {
      await onSave(values);
      reset(emptyValues);
    } catch {
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {product ? "Editar producto terminado" : "Nuevo producto terminado"}
          </DialogTitle>
          <DialogDescription>
            Originales y referencias 1.1 se administran por unidades completas.
            La existencia y costo se registran al recibir una compra.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(submit)}>
          <FormField label="Nombre" error={errors.name?.message} required>
            {(props) => <Input {...props} {...register("name")} />}
          </FormField>
          <FormField label="Marca" error={errors.brand?.message} required>
            {(props) => <Input {...props} {...register("brand")} />}
          </FormField>
          <FormField label="Tipo" required>
            {(props) => (
              <select
                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                {...props}
                {...register("product_type")}
              >
                <option value="original">Original</option>
                <option value="1.1">1.1</option>
              </select>
            )}
          </FormField>
          <FormField label="Presentación" required>
            {(props) => (
              <select
                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                {...props}
                {...register("size_ml")}
              >
                {[30, 50, 60, 100].map((size) => (
                  <option key={size} value={size}>
                    {size} ml
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label="SKU" error={errors.sku?.message} required>
            {(props) => <Input {...props} {...register("sku")} />}
          </FormField>
          <FormField label="Proveedor" error={errors.supplier_id?.message} required>
            {(props) => (
              <select
                className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                {...props}
                {...register("supplier_id")}
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
          <FormField label="Precio de venta (COP)" error={errors.price_cop?.message} required>
            {(props) => (
              <Input
                inputMode="numeric"
                min="0"
                type="number"
                {...props}
                {...register("price_cop")}
              />
            )}
          </FormField>
          <FormField label="Alerta de stock bajo (unidades)" error={errors.minimum_qty?.message}>
            {(props) => (
              <Input
                inputMode="numeric"
                min="0"
                type="number"
                {...props}
                {...register("minimum_qty")}
              />
            )}
          </FormField>
          {product ? (
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
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancelar
            </Button>
            <Button disabled={isSaving || suppliers.length === 0} type="submit">
              {isSaving ? "Guardando…" : "Guardar producto"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProductsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RetailProduct | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ProductFilter>("all");
  const products = useQuery({
    queryKey: inventoryQueryKeys.products,
    queryFn: fetchProducts,
  });
  const suppliers = useQuery({
    queryKey: inventoryQueryKeys.suppliers,
    queryFn: fetchSuppliers,
  });
  const costs = useQuery({
    queryKey: inventoryQueryKeys.costs,
    queryFn: fetchInventoryCosts,
  });
  const saveProduct = useMutation({
    mutationFn: async (values: ProductValues) => {
      if (!supabase) throw new Error("Supabase no está conectado.");
      const { data, error } = await supabase.rpc("admin_save_retail_product", {
        p_product_id: editing?.id ?? null,
        p_name: values.name,
        p_brand: values.brand,
        p_product_type: values.product_type,
        p_sku: values.sku,
        p_size_ml: Number(values.size_ml),
        p_price_cop: Number(values.price_cop),
        p_minimum_qty: Number(values.minimum_qty),
        p_supplier_id: values.supplier_id,
        p_active: values.active !== "false",
      });
      if (error) throw error;
      if (!data) throw new Error("Supabase no confirmó el producto guardado.");
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.products }),
        queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.costs }),
      ]);
      setDialogOpen(false);
      setEditing(null);
      notify.success("Producto guardado.");
    },
    onError: (error) => notify.error(error.message),
  });

  const supplierNames = useMemo(
    () => new Map((suppliers.data ?? []).map((supplier) => [supplier.id, supplier.name])),
    [suppliers.data],
  );
  const productCosts = useMemo(
    () =>
      new Map(
        (costs.data ?? [])
          .filter((cost: InventoryCost) => cost.item_kind === "retail_product")
          .map((cost) => [cost.item_id, cost.avg_unit_cost_cop]),
      ),
    [costs.data],
  );
  const filtered = (products.data ?? []).filter((product) => {
    const matchesText = `${product.name} ${product.brand} ${product.sku}`
      .toLocaleLowerCase("es-CO")
      .includes(search.toLocaleLowerCase("es-CO"));
    const matchesType =
      filter === "all" ||
      filter === "low" ||
      product.product_type === filter;
    const isLow =
      filter !== "low" ||
      (product.minimum_qty > 0 && product.stock_qty <= product.minimum_qty);
    return matchesText && matchesType && isLow;
  });
  const loading = products.isLoading || suppliers.isLoading || costs.isLoading;
  const loadError = products.isError || suppliers.isError || costs.isError;

  return (
    <div className="space-y-7">
      <PageHeading
        action={
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus aria-hidden="true" size={16} />
            Nuevo producto
          </Button>
        }
        description="Catálogo de perfumes originales y referencias 1.1. El stock terminado se cuenta por unidades y el costo se actualiza al recibir compras."
        eyebrow="Catálogo comercial"
        title="Productos terminados"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricTile label="Productos activos" value={(products.data ?? []).filter((item) => item.active).length} />
        <MetricTile label="Originales" value={(products.data ?? []).filter((item) => item.product_type === "original" && item.active).length} />
        <MetricTile label="Referencias 1.1" value={(products.data ?? []).filter((item) => item.product_type === "1.1" && item.active).length} />
      </div>
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Catálogo</CardTitle>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-52">
              <Search
                aria-hidden="true"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                size={15}
              />
              <Input
                aria-label="Buscar productos"
                className="pl-9"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nombre, marca o SKU"
                value={search}
              />
            </div>
            <select
              aria-label="Filtrar productos"
              className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
              onChange={(event) => setFilter(event.target.value as ProductFilter)}
              value={filter}
            >
              <option value="all">Todos los tipos</option>
              <option value="original">Originales</option>
              <option value="1.1">Perfumes 1.1</option>
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
                void suppliers.refetch();
                void costs.refetch();
              }}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              description="Prueba con otros filtros o registra el primer producto."
              title="No hay productos para mostrar"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Presentación</TableHead>
                  <TableHead>Existencia</TableHead>
                  <TableHead>Costo promedio</TableHead>
                  <TableHead>Precio venta</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((product) => {
                  const low =
                    product.active &&
                    product.minimum_qty > 0 &&
                    product.stock_qty <= product.minimum_qty;
                  return (
                    <TableRow key={product.id}>
                      <TableCell>
                        <div className="font-medium">{product.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {product.brand} · {product.sku}
                          {!product.active ? " · Inactivo" : ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="rounded-full bg-muted px-2 py-1 text-xs">
                          {product.product_type === "original" ? "Original" : "1.1"}
                        </span>
                      </TableCell>
                      <TableCell>{product.size_ml ?? "—"} ml</TableCell>
                      <TableCell>
                        <span className={low ? "font-semibold text-red-700" : ""}>
                          {formatQuantity(product.stock_qty)} u
                        </span>
                        <div className="text-xs text-muted-foreground">
                          Mín. {formatQuantity(product.minimum_qty)}
                        </div>
                      </TableCell>
                      <TableCell>{formatCop(productCosts.get(product.id) ?? 0)}</TableCell>
                      <TableCell>{formatCop(product.price_cop)}</TableCell>
                      <TableCell>
                        {product.supplier_id
                          ? supplierNames.get(product.supplier_id) ?? "Proveedor inactivo"
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          aria-label={`Editar ${product.name}`}
                          onClick={() => {
                            setEditing(product);
                            setDialogOpen(true);
                          }}
                          size="sm"
                          variant="outline"
                        >
                          <Pencil aria-hidden="true" size={14} />
                          Editar
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <aside className="flex items-start gap-3 rounded-xl border border-gold/20 bg-gold-soft/60 p-4 text-xs leading-5 text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-gold" size={16} />
        <p>
          El inventario inicial, las entradas y su costo se registran mediante
          compras o ajustes autorizados para conservar el historial; no se
          modifica la existencia directamente desde el catálogo.
        </p>
      </aside>
      <ProductDialog
        isSaving={saveProduct.isPending}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        onSave={(values) => saveProduct.mutateAsync(values)}
        open={dialogOpen}
        product={editing}
        suppliers={suppliers.data ?? []}
      />
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        <CardTitle className="font-serif text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted-foreground">
        Referencias registradas
      </CardContent>
    </Card>
  );
}
