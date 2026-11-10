import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  CircleDollarSign,
  Clock3,
  Minus,
  PackagePlus,
  Plus,
  Printer,
  Search,
  ShoppingBag,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/features/auth/use-auth";
import { EmptyState, LoadingState, PageHeading } from "@/features/inventory/components";
import { formatCop, formatQuantity } from "@/features/inventory/format";
import { fetchInventoryCosts } from "@/features/inventory/data";
import { fetchRecipes } from "@/features/recipes/data";
import { estimateManufactureCost } from "@/features/recipes/costing";
import type { Recipe } from "@/features/recipes/types";
import { fetchPosProducts, fetchPosCashSessions, fetchPaymentMethods, fetchSalesCustomers, createSalesCustomer, registerPosSale, fetchSalesHistory, configurePaymentMethod, reverseSale, salesQueryKeys } from "@/features/sales/data";
import { SaleReceipt } from "@/features/sales/receipt";
import type { PaymentMethod, PosCategory, SaleCartLine, SaleRecord } from "@/features/sales/types";
import type { InventoryCost, RetailProduct } from "@/features/inventory/types";
import { notify } from "@/lib/notifications";

const paymentLabels: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
  other: "Otro",
};
const materialUnits: Record<string, string> = {
  g: "g",
  ml: "ml",
  unit: "unidades",
  dose: "dosis",
};

function recipeLabel(recipe: Recipe) {
  return `${recipe.perfumes?.brand ?? "Perfume"} · ${recipe.perfumes?.name ?? "Sin nombre"} · ${recipe.size_ml} ml`;
}

function itemLabel(item: SaleCartLine, products: RetailProduct[], recipes: Recipe[]) {
  if (item.kind === "retail_product") {
    return products.find((product) => product.id === item.id)?.name ?? "Producto no disponible";
  }
  const recipe = recipes.find((candidate) => candidate.id === item.id);
  return recipe ? recipeLabel(recipe) : "Receta no disponible";
}

function selectedEstimate(
  line: SaleCartLine,
  recipes: Recipe[],
  costs: InventoryCost[],
): number | null {
  if (line.kind === "retail_product") {
    const cost = costs.find(
      (entry) => entry.item_kind === "retail_product" && entry.item_id === line.id,
    );
    return cost ? Math.round(cost.avg_unit_cost_cop * line.quantity) : null;
  }
  const recipe = recipes.find((candidate) => candidate.id === line.id);
  if (!recipe) return null;
  return estimateManufactureCost(
    recipe,
    costs,
    line.quantity,
    line.fill_consumption_ml ?? undefined,
  );
}

function selectedPrice(line: SaleCartLine, products: RetailProduct[], recipes: Recipe[]) {
  if (line.kind === "retail_product") {
    return products.find((product) => product.id === line.id)?.price_cop ?? 0;
  }
  return recipes.find((recipe) => recipe.id === line.id)?.price_cop ?? 0;
}

function availableFor(line: SaleCartLine, products: RetailProduct[], recipes: Recipe[]) {
  if (line.kind === "retail_product") {
    return products.find((product) => product.id === line.id)?.stock_qty ?? 0;
  }
  const recipe = recipes.find((candidate) => candidate.id === line.id);
  if (!recipe) return 0;
  return Math.min(
    ...recipe.recipe_components.map((component) => {
      const material = component.materials;
      if (!material) return 0;
      const perBottle =
        component.mode === "fill_to_volume"
          ? line.fill_consumption_ml
          : component.quantity;
      if (perBottle === null) return Number.POSITIVE_INFINITY;
      return perBottle > 0 ? Math.floor(material.on_hand_qty / perBottle) : 0;
    }),
    Number.POSITIVE_INFINITY,
  );
}

function itemKey(line: Pick<SaleCartLine, "kind" | "id">) {
  return `${line.kind}:${line.id}`;
}

function sanitizedQueryError(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return { message: String(error) };
  }
  const record = error as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : undefined,
    message:
      typeof record.message === "string"
        ? record.message
        : "Unknown data loading error",
    hint: typeof record.hint === "string" ? record.hint : undefined,
  };
}

export function PosPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"pos" | "history">("pos");
  const [category, setCategory] = useState<PosCategory>("original");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<SaleCartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [customerId, setCustomerId] = useState("");
  const [cashSessionId, setCashSessionId] = useState("");
  const [discountInput, setDiscountInput] = useState("0");
  const [notes, setNotes] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [receipt, setReceipt] = useState<SaleRecord | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<SaleRecord | null>(null);
  const [reverseOperation, setReverseOperation] = useState<"void" | "refund">("void");
  const [reverseReason, setReverseReason] = useState("");
  const [restoreInventory, setRestoreInventory] = useState(false);
  const [refundMethod, setRefundMethod] = useState<PaymentMethod | "">("");
  const [refundCashSession, setRefundCashSession] = useState("");
  const [configureTarget, setConfigureTarget] = useState<PaymentMethodOptionForm | null>(null);
  const reportedLoadErrors = useRef(new Set<unknown>());

  const products = useQuery({
    queryKey: salesQueryKeys.products,
    queryFn: fetchPosProducts,
  });
  const recipes = useQuery({
    queryKey: salesQueryKeys.recipes,
    queryFn: fetchRecipes,
  });
  const costs = useQuery({
    queryKey: salesQueryKeys.costs,
    queryFn: fetchInventoryCosts,
    enabled: isAdmin,
  });
  const customers = useQuery({
    queryKey: salesQueryKeys.customers,
    queryFn: fetchSalesCustomers,
  });
  const methods = useQuery({
    queryKey: salesQueryKeys.paymentMethods,
    queryFn: fetchPaymentMethods,
  });
  const cashSessions = useQuery({
    queryKey: [...salesQueryKeys.cashSessions, profile?.id],
    queryFn: () => fetchPosCashSessions(profile?.id ?? ""),
    enabled: Boolean(profile?.id),
  });
  const history = useQuery({
    queryKey: salesQueryKeys.history,
    queryFn: fetchSalesHistory,
  });

  const activeRecipes = useMemo(
    () => (recipes.data ?? []).filter((recipe) => recipe.status === "active"),
    [recipes.data],
  );
  const enabledMethods = (methods.data ?? []).filter((method) => method.enabled);
  const activePayment = enabledMethods.find((method) => method.method === paymentMethod);
  const visibleProducts = (products.data ?? []).filter((product) => {
    const matchesCategory =
      category === "replica" ? false : product.product_type === category;
    const query = search.toLocaleLowerCase("es-CO");
    const matchesSearch = `${product.name} ${product.brand} ${product.sku}`
      .toLocaleLowerCase("es-CO")
      .includes(query);
    return matchesCategory && matchesSearch;
  });
  const visibleRecipes = activeRecipes.filter((recipe) =>
    `${recipe.perfumes?.brand ?? ""} ${recipe.perfumes?.name ?? ""} ${recipe.size_ml} ml`
      .toLocaleLowerCase("es-CO")
      .includes(search.toLocaleLowerCase("es-CO")),
  );
  const subtotal = cart.reduce(
    (total, line) => total + selectedPrice(line, products.data ?? [], activeRecipes) * line.quantity,
    0,
  );
  const discount = /^\d+$/.test(discountInput) ? Number(discountInput) : 0;
  const total = Math.max(0, subtotal - discount);
  const estimatedCost = isAdmin
    ? cart.reduce((sum, line) => sum + (selectedEstimate(
        line,
        activeRecipes,
        costs.data ?? [],
      ) ?? 0), 0)
    : null;
  const hasUnknownCost = isAdmin && cart.some((line) => selectedEstimate(
    line,
    activeRecipes,
    costs.data ?? [],
  ) === null);
  const inventoryIssues = (() => {
    const issues: string[] = [];
    const materialRequirements = new Map<
      string,
      {
        material: NonNullable<Recipe["recipe_components"][number]["materials"]>;
        quantity: number;
      }
    >();

    for (const line of cart) {
      if (line.kind === "retail_product") {
        const product = (products.data ?? []).find((item) => item.id === line.id);
        if (!product) {
          issues.push("Producto no disponible en el catálogo");
        } else if (product.stock_qty < line.quantity) {
          issues.push(
            `${product.name}: requiere ${line.quantity}, disponibles ${product.stock_qty}`,
          );
        }
        continue;
      }

      const recipe = activeRecipes.find((item) => item.id === line.id);
      if (!recipe) {
        issues.push(
          `${itemLabel(line, products.data ?? [], activeRecipes)}: receta ya no disponible`,
        );
        continue;
      }
      const fixedMilliliters = recipe.recipe_components.reduce(
        (sum, component) =>
          component.mode === "fixed" &&
          component.materials?.base_unit === "ml"
            ? sum + (component.quantity ?? 0)
            : sum,
        0,
      );
      for (const component of recipe.recipe_components) {
        const material = component.materials;
        if (!material) {
          issues.push("Material de receta no disponible");
          continue;
        }
        const perBottle = component.mode === "fill_to_volume"
          ? line.fill_consumption_ml
          : component.quantity;
        if (perBottle === null) {
          issues.push(`${material.name}: registra el consumo real antes de confirmar`);
          continue;
        }
        if (
          perBottle <= 0 ||
          component.mode === "fill_to_volume" &&
            perBottle + fixedMilliliters > recipe.size_ml
        ) {
          issues.push(`${material.name}: el consumo medido no es válido para la presentación`);
          continue;
        }
        const current = materialRequirements.get(material.id);
        materialRequirements.set(material.id, {
          material,
          quantity: (current?.quantity ?? 0) + perBottle * line.quantity,
        });
      }
    }

    for (const { material, quantity } of materialRequirements.values()) {
      if (material.on_hand_qty < quantity) {
        issues.push(
          `${material.name}: requiere ${formatQuantity(quantity)} ${materialUnits[material.base_unit]}, disponibles ${formatQuantity(material.on_hand_qty)}`,
        );
      }
    }
    return issues;
  })();
  const loadQueries = [
    { label: "productos", query: products },
    { label: "recetas activas", query: recipes },
    { label: "clientes", query: customers },
    { label: "métodos de pago", query: methods },
    { label: "cajas abiertas", query: cashSessions },
    { label: "historial de ventas", query: history },
    ...(isAdmin ? [{ label: "costos", query: costs }] : []),
  ];
  const loadFailures = loadQueries.filter(({ query }) => query.isError);
  const loading = loadQueries.some(({ query }) => query.isLoading);
  const loadError = loadFailures.length > 0;
  const historyFailed = history.isError;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    for (const failure of loadFailures) {
      if (reportedLoadErrors.current.has(failure.query.error)) continue;
      reportedLoadErrors.current.add(failure.query.error);
      console.error(
        `[Ventas] No se pudieron cargar ${failure.label}.`,
        sanitizedQueryError(failure.query.error),
      );
    }
  });
  const filteredHistory = (history.data ?? []).filter((sale) => {
    const searchText = historySearch.trim().toLocaleLowerCase("es-CO");
    return !searchText || [
      String(sale.sale_number),
      sale.customer?.full_name ?? "",
      sale.items.map((item) => item.item_name_snapshot).join(" "),
    ].join(" ").toLocaleLowerCase("es-CO").includes(searchText);
  });

  const invalidateStock = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: salesQueryKeys.products }),
      queryClient.invalidateQueries({ queryKey: salesQueryKeys.costs }),
      queryClient.invalidateQueries({ queryKey: salesQueryKeys.history }),
      queryClient.invalidateQueries({ queryKey: ["inventory-movements"] }),
      queryClient.invalidateQueries({ queryKey: ["recipe-open-cash-sessions"] }),
      queryClient.invalidateQueries({ queryKey: salesQueryKeys.cashSessions }),
    ]);
  };

  const checkoutMutation = useMutation({
    mutationFn: registerPosSale,
    onSuccess: async (saleId) => {
      await invalidateStock();
      const saleHistory = await queryClient.fetchQuery({
        queryKey: salesQueryKeys.history,
        queryFn: fetchSalesHistory,
      });
      setReceipt(saleHistory.find((sale) => sale.id === saleId) ?? null);
      setCart([]);
      setDiscountInput("0");
      setNotes("");
      setCashSessionId("");
      setIdempotencyKey(crypto.randomUUID());
      notify.success("Venta confirmada y existencias actualizadas.");
    },
    onError: (error) => notify.error(error.message),
  });

  const customerMutation = useMutation({
    mutationFn: createSalesCustomer,
    onSuccess: async (customerIdCreated) => {
      await queryClient.invalidateQueries({ queryKey: salesQueryKeys.customers });
      setCustomerId(customerIdCreated);
      setIdempotencyKey(crypto.randomUUID());
      setCustomerDialogOpen(false);
      setNewCustomerName("");
      setNewCustomerPhone("");
      notify.success("Cliente registrado.");
    },
    onError: (error) => notify.error(error.message),
  });
  const paymentSettingsMutation = useMutation({
    mutationFn: configurePaymentMethod,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: salesQueryKeys.paymentMethods });
      setConfigureTarget(null);
      notify.success("Método de pago actualizado.");
    },
    onError: (error) => notify.error(error.message),
  });
  const reverseMutation = useMutation({
    mutationFn: reverseSale,
    onSuccess: async () => {
      await invalidateStock();
      setReverseTarget(null);
      setReverseReason("");
      setRestoreInventory(false);
      setRefundMethod("");
      setRefundCashSession("");
      notify.success("Ajuste autorizado y registrado. La venta se conserva en el historial.");
    },
    onError: (error) => notify.error(error.message),
  });

  function updateCart(updater: (current: SaleCartLine[]) => SaleCartLine[]) {
    setCart((current) => updater(current));
    setIdempotencyKey(crypto.randomUUID());
  }

  function addProduct(product: RetailProduct) {
    updateCart((current) => {
      const existing = current.find((line) => line.kind === "retail_product" && line.id === product.id);
      if (existing) {
        return current.map((line) => line === existing
          ? { ...line, quantity: line.quantity + 1 }
          : line);
      }
      return [...current, {
        key: itemKey({ kind: "retail_product", id: product.id }),
        kind: "retail_product",
        id: product.id,
        quantity: 1,
        fill_consumption_ml: null,
      }];
    });
  }

  function addRecipe(recipe: Recipe) {
    updateCart((current) => {
      const existing = current.find((line) => line.kind === "recipe" && line.id === recipe.id);
      if (existing) {
        return current.map((line) => line === existing
          ? { ...line, quantity: line.quantity + 1 }
          : line);
      }
      return [...current, {
        key: itemKey({ kind: "recipe", id: recipe.id }),
        kind: "recipe",
        id: recipe.id,
        quantity: 1,
        fill_consumption_ml: null,
      }];
    });
  }

  function changeQuantity(key: string, value: number) {
    if (!Number.isSafeInteger(value) || value > 999999) return;
    updateCart((current) => current.flatMap((line) => {
      if (line.key !== key) return [line];
      return value < 1 ? [] : [{ ...line, quantity: value }];
    }));
  }

  function changeFillConsumption(key: string, input: string) {
    const value = input === "" ? null : Number(input);
    updateCart((current) => current.map((line) =>
      line.key === key ? { ...line, fill_consumption_ml: value } : line,
    ));
  }

  function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cart.length) {
      notify.error("Agrega al menos un producto antes de confirmar.");
      return;
    }
    if (!activePayment) {
      notify.error("Selecciona un método de pago habilitado.");
      return;
    }
    if (!/^\d+$/.test(discountInput) || !Number.isSafeInteger(discount) || discount > subtotal) {
      notify.error("El descuento debe ser un valor entero COP que no supere el subtotal.");
      return;
    }
    if (!cashSessionId) {
      notify.error("Selecciona una caja abierta para asociar la venta.");
      return;
    }
    if (inventoryIssues.length) {
      notify.error(`Revisa existencias antes de confirmar: ${inventoryIssues[0]}.`);
      return;
    }
    checkoutMutation.mutate({
      items: cart.map((line) => ({
        kind: line.kind,
        id: line.id,
        quantity: line.quantity,
        fill_consumption_ml: line.fill_consumption_ml,
      })),
      payment_method: activePayment.method,
      idempotency_key: idempotencyKey,
      discount_cop: isAdmin ? discount : 0,
      customer_id: customerId || null,
      cash_session_id: activePayment.method === "cash" ? cashSessionId : null,
      notes,
    });
  }

  const cancelCart = () => {
    updateCart(() => []);
    setDiscountInput("0");
    setNotes("");
    setCashSessionId("");
    setCustomerId("");
    notify.info("Carrito cancelado. No se registró ningún movimiento.");
  };

  function startReverse(sale: SaleRecord, operation: "void" | "refund") {
    setReverseTarget(sale);
    setReverseOperation(operation);
    setRefundMethod(sale.payment_method);
    setReverseReason("");
    setRestoreInventory(false);
  }

  function confirmReverse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reverseTarget) return;
    if (reverseReason.trim().length < 3) {
      notify.error("Describe el motivo con al menos 3 caracteres.");
      return;
    }
    if (!refundMethod) {
      notify.error("Selecciona el método usado para devolver el pago.");
      return;
    }
    if (refundMethod === "cash" && !refundCashSession) {
      notify.error("Selecciona una caja abierta de administrador para el reembolso en efectivo.");
      return;
    }
    reverseMutation.mutate({
      sale_id: reverseTarget.id,
      operation: reverseOperation,
      reason: reverseReason,
      restore_inventory: restoreInventory,
      refund_payment_method: refundMethod as PaymentMethod,
      cash_session_id: refundMethod === "cash"
        ? refundCashSession
        : null,
    });
  }

  async function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newCustomerName.trim().length < 1) {
      notify.error("Ingresa el nombre del cliente.");
      return;
    }
    if (!profile?.id) {
      notify.error("No se pudo identificar al usuario actual.");
      return;
    }
    customerMutation.mutate({
      full_name: newCustomerName,
      phone: newCustomerPhone,
      created_by: profile.id,
    });
  }

  function updateSetting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configureTarget) return;
    paymentSettingsMutation.mutate(configureTarget);
  }

  return (
    <div className="space-y-7">
      <PageHeading
        action={
          <div className="flex flex-wrap gap-2">
            {isAdmin ? (
              <Button onClick={() => setSettingsOpen((open) => !open)} variant="outline">
                Configurar pagos
              </Button>
            ) : null}
            <Button
              onClick={() => setActiveTab("history")}
              variant={activeTab === "history" ? "default" : "outline"}
            >
              <Clock3 aria-hidden="true" size={16} />
              Historial
            </Button>
          </div>
        }
        description="Ventas de productos por unidad y réplicas fabricadas exclusivamente bajo pedido. Los movimientos se registran al confirmar."
        eyebrow="Operación comercial"
        title="Punto de venta"
      />

      <div className="flex gap-2 border-b border-border">
        <button
          className={`border-b-2 px-4 py-2 text-sm font-medium ${activeTab === "pos" ? "border-gold text-foreground" : "border-transparent text-muted-foreground"}`}
          onClick={() => setActiveTab("pos")}
          type="button"
        >
          Nueva venta
        </button>
        <button
          className={`border-b-2 px-4 py-2 text-sm font-medium ${activeTab === "history" ? "border-gold text-foreground" : "border-transparent text-muted-foreground"}`}
          onClick={() => setActiveTab("history")}
          type="button"
        >
          Historial y comprobantes
        </button>
      </div>

      {settingsOpen && isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Métodos de pago disponibles</CardTitle>
            <CardDescription>
              Habilita métodos y personaliza sus etiquetas. Los tipos disponibles dependen del esquema de pagos.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {enabledMethods.map((method) => (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3" key={method.method}>
                <div>
                  <p className="text-sm font-medium">{method.label}</p>
                  <p className="text-xs text-muted-foreground">{method.enabled ? "Habilitado" : "Deshabilitado"}</p>
                </div>
                <Button
                  onClick={() => setConfigureTarget({
                    method: method.method,
                    label: method.label,
                    enabled: !method.enabled,
                  })}
                  size="sm"
                  variant={method.enabled ? "outline" : "default"}
                >
                  {method.enabled ? "Deshabilitar" : "Habilitar"}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "pos" ? (
        loading ? (
          <LoadingState label="Cargando catálogo, recetas y existencias…" />
        ) : loadError ? (
          <SalesLoadError
            details={`No fue posible cargar: ${loadFailures.map(({ label }) => label).join(", ")}. Verifica la conexión o solicita al administrador que valide las migraciones y permisos de Supabase.`}
            onRetry={() => {
              for (const { query } of loadFailures) void query.refetch();
            }}
          />
        ) : (
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,0.8fr)]">
            <Card>
              <CardHeader className="gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShoppingBag aria-hidden="true" className="text-gold" size={17} />
                    Catálogo
                  </CardTitle>
                  <CardDescription>Selecciona originales, referencias 1.1 o una réplica con receta activa.</CardDescription>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <div className="relative">
                    <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
                    <Input
                      aria-label="Buscar productos para vender"
                      className="pl-9"
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar por nombre, marca o SKU"
                      value={search}
                    />
                  </div>
                  <div className="flex rounded-lg border border-border p-1">
                    {([
                      ["original", "Originales"],
                      ["1.1", "Perfumes 1.1"],
                      ["replica", "Réplicas"],
                    ] as const).map(([value, label]) => (
                      <button
                        aria-pressed={category === value}
                        className={`rounded-md px-3 py-2 text-xs font-medium ${category === value ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
                        key={value}
                        onClick={() => setCategory(value)}
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {category === "replica" ? (
                  activeRecipes.length ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {visibleRecipes.map((recipe) => (
                        <RecipeChoice
                          key={recipe.id}
                          onAdd={() => addRecipe(recipe)}
                          recipe={recipe}
                          disabled={checkoutMutation.isPending}
                        />
                      ))}
                      {!visibleRecipes.length ? (
                        <div className="sm:col-span-2">
                          <EmptyState description="Cambia la búsqueda o activa una fórmula desde Recetas." title="No hay recetas coincidentes" />
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <EmptyState
                      description="No hay fórmulas activas. La réplica no puede venderse sin una receta activa."
                      title="No hay réplicas disponibles"
                    />
                  )
                ) : visibleProducts.length ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {visibleProducts.map((product) => (
                      <ProductChoice
                        key={product.id}
                        onAdd={() => addProduct(product)}
                        product={product}
                        disabled={checkoutMutation.isPending}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState description="No hay productos activos para el filtro seleccionado." title="Catálogo vacío" />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Venta actual</CardTitle>
                  <CardDescription>{cart.length} líneas · sin descuentos de inventario hasta confirmar</CardDescription>
                </div>
                {cart.length ? (
                  <Button disabled={checkoutMutation.isPending} onClick={cancelCart} size="sm" variant="ghost">Cancelar</Button>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4">
                {!cart.length ? (
                  <EmptyState description="Agrega productos o fórmulas al carrito para iniciar." title="No hay artículos" />
                ) : (
                  <div className="space-y-4">
                    {cart.map((line) => {
                      const recipe = line.kind === "recipe"
                        ? activeRecipes.find((candidate) => candidate.id === line.id)
                        : null;
                      const fill = recipe?.recipe_components.find(
                        (component) => component.mode === "fill_to_volume",
                      );
                      const fillMaximum = recipe
                        ? recipe.size_ml - recipe.recipe_components.reduce(
                            (sum, component) =>
                              component.mode === "fixed" &&
                              component.materials?.base_unit === "ml"
                                ? sum + (component.quantity ?? 0)
                                : sum,
                            0,
                          )
                        : 0;
                      const lineCost = isAdmin
                        ? selectedEstimate(line, activeRecipes, costs.data ?? [])
                        : null;
                      return (
                        <div className="rounded-xl border border-border p-3" key={line.key}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{itemLabel(line, products.data ?? [], activeRecipes)}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatCop(selectedPrice(line, products.data ?? [], activeRecipes))} c/u
                                {isAdmin ? ` · costo ${lineCost === null ? "pendiente de medición" : formatCop(lineCost)}` : ""}
                              </p>
                            </div>
                            <Button
                              aria-label={`Quitar ${itemLabel(line, products.data ?? [], activeRecipes)}`}
                              disabled={checkoutMutation.isPending}
                              onClick={() => changeQuantity(line.key, 0)}
                              size="icon"
                              variant="ghost"
                            >
                              <Trash2 aria-hidden="true" size={15} />
                            </Button>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <Button
                                aria-label="Disminuir cantidad"
                                disabled={checkoutMutation.isPending}
                                onClick={() => changeQuantity(line.key, line.quantity - 1)}
                                size="icon"
                                variant="outline"
                              >
                                <Minus aria-hidden="true" size={14} />
                              </Button>
                              <Input
                                aria-label="Cantidad"
                                className="w-20 text-center"
                                disabled={checkoutMutation.isPending}
                                min="1"
                                onChange={(event) => changeQuantity(line.key, Number(event.target.value))}
                                step="1"
                                type="number"
                                value={line.quantity}
                              />
                              <Button
                                aria-label="Aumentar cantidad"
                                disabled={checkoutMutation.isPending}
                                onClick={() => changeQuantity(line.key, line.quantity + 1)}
                                size="icon"
                                variant="outline"
                              >
                                <Plus aria-hidden="true" size={14} />
                              </Button>
                            </div>
                            <p className="text-sm font-semibold">
                              {formatCop(selectedPrice(line, products.data ?? [], activeRecipes) * line.quantity)}
                            </p>
                          </div>
                          {fill ? (
                            <FormField
                              className="mt-3"
                              description={`Consumo real por frasco; máximo ${formatQuantity(fillMaximum)} ml. Se validará contra existencias al confirmar.`}
                              label={`${fill.materials?.name ?? "Componente variable"} medido (ml por unidad)`}
                              required
                            >
                              {(props) => (
                                <Input
                                  {...props}
                                  disabled={checkoutMutation.isPending}
                                  inputMode="decimal"
                                  max={fillMaximum}
                                  min="0.0001"
                                  onChange={(event) => changeFillConsumption(line.key, event.target.value)}
                                  placeholder="Registrar al preparar"
                                  step="0.0001"
                                  type="number"
                                  value={line.fill_consumption_ml ?? ""}
                                />
                              )}
                            </FormField>
                          ) : null}
                          {recipe ? (
                            <ul className="mt-3 space-y-1 border-t border-border pt-3">
                              {recipe.recipe_components.map((component) => {
                                const material = component.materials;
                                const perUnit = component.mode === "fill_to_volume"
                                  ? line.fill_consumption_ml
                                  : component.quantity;
                                const required = perUnit === null ? null : perUnit * line.quantity;
                                return (
                                  <li className="flex justify-between gap-2 text-xs" key={component.id}>
                                    <span>{material?.name ?? "Material"}</span>
                                    <span className="text-right text-muted-foreground">
                                      {component.mode === "fill_to_volume"
                                        ? required === null
                                          ? "variable · registrar consumo real"
                                          : `${formatQuantity(required)} ml · ${formatQuantity(material?.on_hand_qty ?? 0)} ml disponibles`
                                        : `${formatQuantity(required ?? 0)} ${material ? materialUnits[material.base_unit] : ""} · ${formatQuantity(material?.on_hand_qty ?? 0)} disponibles`}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}

                <form className="space-y-4 border-t border-border pt-4" onSubmit={checkout}>
                  <div className="flex gap-2">
                    <FormField className="min-w-0 flex-1" label="Cliente (opcional)">
                      {(props) => (
                        <select
                          {...props}
                          className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                          disabled={checkoutMutation.isPending}
                          onChange={(event) => {
                            setCustomerId(event.target.value);
                            setIdempotencyKey(crypto.randomUUID());
                          }}
                          value={customerId}
                        >
                          <option value="">Venta sin cliente</option>
                          {(customers.data ?? []).map((customer) => (
                            <option key={customer.id} value={customer.id}>{customer.full_name}</option>
                          ))}
                        </select>
                      )}
                    </FormField>
                    <Button
                      aria-label="Registrar cliente"
                      className="mt-6"
                      disabled={checkoutMutation.isPending}
                      onClick={() => setCustomerDialogOpen(true)}
                      size="icon"
                      type="button"
                      variant="outline"
                    >
                      <UserPlus aria-hidden="true" size={16} />
                    </Button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label="Método de pago" required>
                      {(props) => (
                        <select
                          {...props}
                          className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                          disabled={checkoutMutation.isPending}
                          onChange={(event) => {
                            setPaymentMethod(event.target.value as PaymentMethod);
                            setCashSessionId("");
                            setIdempotencyKey(crypto.randomUUID());
                          }}
                          value={paymentMethod}
                        >
                          <option value="">Selecciona un método</option>
                          {(methods.data ?? []).map((method) => (
                            <option key={method.method} value={method.method}>{method.label}</option>
                          ))}
                        </select>
                      )}
                    </FormField>
                    <FormField label="Caja abierta" required>
                      {(props) => (
                        <select
                          {...props}
                          className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                          disabled={checkoutMutation.isPending}
                          onChange={(event) => {
                            setCashSessionId(event.target.value);
                            setIdempotencyKey(crypto.randomUUID());
                          }}
                          value={cashSessionId}
                        >
                          <option value="">Selecciona caja</option>
                          {(cashSessions.data ?? []).map((session) => (
                            <option key={session.id} value={session.id}>{session.id.slice(0, 8)}</option>
                          ))}
                        </select>
                      )}
                    </FormField>
                    {isAdmin ? (
                      <FormField label="Descuento (COP)">
                        {(props) => (
                          <Input
                            {...props}
                            inputMode="numeric"
                            disabled={checkoutMutation.isPending}
                            max={subtotal}
                            min="0"
                            onChange={(event) => {
                              setDiscountInput(event.target.value);
                              setIdempotencyKey(crypto.randomUUID());
                            }}
                            type="number"
                            value={discountInput}
                          />
                        )}
                      </FormField>
                    ) : null}
                    <FormField className={isAdmin ? "" : "sm:col-span-2"} label="Notas (opcional)">
                      {(props) => (
                        <Input
                          {...props}
                          maxLength={1000}
                          disabled={checkoutMutation.isPending}
                          onChange={(event) => {
                            setNotes(event.target.value);
                            setIdempotencyKey(crypto.randomUUID());
                          }}
                          value={notes}
                        />
                      )}
                    </FormField>
                  </div>

                  {inventoryIssues.length ? (
                    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
                      {inventoryIssues.join("; ")}
                    </p>
                  ) : null}

                  <div className="space-y-2 border-t border-border pt-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span>{formatCop(subtotal)}</span>
                    </div>
                    {isAdmin && discount > 0 ? (
                      <div className="flex justify-between text-muted-foreground">
                        <span>Descuento autorizado</span>
                        <span>-{formatCop(discount)}</span>
                      </div>
                    ) : null}
                    <div className="flex justify-between border-t border-border pt-3 text-lg font-semibold">
                      <span>Total</span>
                      <span>{formatCop(total)}</span>
                    </div>
                    {isAdmin ? (
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Costo estimado / utilidad</span>
                        <span>
                          {hasUnknownCost ? "Costo variable pendiente" : formatCop(estimatedCost ?? 0)}
                          {!hasUnknownCost && estimatedCost !== null
                            ? ` / ${formatCop(total - estimatedCost)}`
                            : ""}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <Button
                    className="w-full"
                    disabled={
                      checkoutMutation.isPending ||
                      !cart.length ||
                      !activePayment ||
                      inventoryIssues.length > 0 ||
                      !cashSessionId ||
                      !/^\d+$/.test(discountInput) ||
                      discount > subtotal
                    }
                    type="submit"
                  >
                    <Check aria-hidden="true" size={16} />
                    {checkoutMutation.isPending ? "Confirmando venta…" : "Confirmar venta"}
                  </Button>
                  <p className="text-center text-[11px] leading-5 text-muted-foreground">
                    Toda venta queda asociada a la caja abierta; el efectivo se suma al saldo esperado y los otros medios se reportan por separado. El inventario solo se descuenta al confirmar.
                  </p>
                </form>
              </CardContent>
            </Card>
          </div>
        )
      ) : (
        <Card>
          <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Historial reciente</CardTitle>
              <CardDescription>Las ventas finalizadas se conservan; las anulaciones y devoluciones muestran su ajuste.</CardDescription>
            </div>
            <div className="relative w-full sm:max-w-xs">
              <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
              <Input
                aria-label="Buscar en historial de ventas"
                className="pl-9"
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Venta, cliente o producto"
                value={historySearch}
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {history.isLoading ? (
              <LoadingState label="Cargando historial…" />
            ) : historyFailed ? (
              <SalesLoadError
                details="No fue posible cargar el historial de ventas. Verifica la conexión o solicita al administrador que valide las migraciones y permisos de Supabase."
                onRetry={() => void history.refetch()}
              />
            ) : !filteredHistory.length ? (
              <EmptyState description="Las ventas confirmadas aparecerán aquí." title="Sin ventas" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Venta</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Artículos</TableHead>
                    <TableHead>Pago</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Comprobante</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredHistory.map((sale) => (
                    <TableRow key={sale.id}>
                      <TableCell className="font-medium">#{sale.sale_number}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {new Intl.DateTimeFormat("es-CO", {
                          dateStyle: "short",
                          timeStyle: "short",
                          timeZone: "America/Bogota",
                        }).format(new Date(sale.created_at))}
                      </TableCell>
                      <TableCell>{sale.customer?.full_name ?? "Sin cliente"}</TableCell>
                      <TableCell className="max-w-56 truncate">
                        {sale.items.map((item) => `${item.item_name_snapshot} × ${formatQuantity(item.quantity)}`).join(", ")}
                      </TableCell>
                      <TableCell>{methods.data?.find((method) => method.method === sale.payment_method)?.label ?? paymentLabels[sale.payment_method]}</TableCell>
                      <TableCell>
                        <span className={sale.status === "completed" ? "text-emerald-800" : "text-amber-800"}>
                          {sale.status === "completed" ? "Finalizada" : sale.adjustment?.operation === "refund" ? "Devuelta" : "Anulada"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatCop(sale.total_cop)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            aria-label={`Ver comprobante de venta ${sale.sale_number}`}
                            onClick={() => setReceipt(sale)}
                            size="icon"
                            variant="ghost"
                          >
                            <Printer aria-hidden="true" size={15} />
                          </Button>
                          {isAdmin && sale.status === "completed" ? (
                            <>
                              <Button
                                onClick={() => startReverse(sale, "void")}
                                size="sm"
                                variant="ghost"
                              >
                                Anular
                              </Button>
                              <Button
                                onClick={() => startReverse(sale, "refund")}
                                size="sm"
                                variant="ghost"
                              >
                                Devolver
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {receipt ? (
        <SaleReceipt
          onClose={() => setReceipt(null)}
          paymentLabel={
            methods.data?.find((method) => method.method === receipt.payment_method)?.label
          }
          sale={receipt}
        />
      ) : null}

      <Dialog open={customerDialogOpen} onOpenChange={setCustomerDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar cliente</DialogTitle>
            <DialogDescription>El cliente queda asociado a la venta después de guardarlo.</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={submitCustomer}>
            <FormField label="Nombre completo" required>
              {(props) => (
                <Input {...props} onChange={(event) => setNewCustomerName(event.target.value)} value={newCustomerName} />
              )}
            </FormField>
            <FormField label="Teléfono (opcional)">
              {(props) => (
                <Input {...props} onChange={(event) => setNewCustomerPhone(event.target.value)} value={newCustomerPhone} />
              )}
            </FormField>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setCustomerDialogOpen(false)} type="button" variant="outline">Cancelar</Button>
              <Button disabled={customerMutation.isPending} type="submit">
                {customerMutation.isPending ? "Guardando…" : "Guardar cliente"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(configureTarget)}
        onOpenChange={(open) => {
          if (!open) setConfigureTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurar método de pago</DialogTitle>
            <DialogDescription>La disponibilidad y etiqueta se guardan en PostgreSQL.</DialogDescription>
          </DialogHeader>
          {configureTarget ? (
            <form className="grid gap-4" onSubmit={updateSetting}>
              <FormField label="Nombre visible" required>
                {(props) => (
                  <Input
                    {...props}
                    maxLength={40}
                    onChange={(event) => setConfigureTarget({ ...configureTarget, label: event.target.value })}
                    value={configureTarget.label}
                  />
                )}
              </FormField>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={configureTarget.enabled}
                  onChange={(event) => setConfigureTarget({ ...configureTarget, enabled: event.target.checked })}
                  type="checkbox"
                />
                Disponible para registrar ventas
              </label>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setConfigureTarget(null)} type="button" variant="outline">Cancelar</Button>
                <Button disabled={paymentSettingsMutation.isPending} type="submit">
                  {paymentSettingsMutation.isPending ? "Guardando…" : "Guardar método"}
                </Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(reverseTarget)}
        onOpenChange={(open) => {
          if (!open) setReverseTarget(null);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{reverseOperation === "void" ? "Anular venta" : "Registrar devolución total"}</DialogTitle>
            <DialogDescription>
              La venta nunca se borra. Se conserva el historial y esta acción administrativa agrega un ajuste compensatorio.
            </DialogDescription>
          </DialogHeader>
          {reverseTarget ? (
            <form className="grid gap-4" onSubmit={confirmReverse}>
              <p className="rounded-lg bg-muted/50 p-3 text-sm">
                Venta #{reverseTarget.sale_number} · {formatCop(reverseTarget.total_cop)}
              </p>
              <FormField label="Método para devolver el pago" required>
                  {(props) => (
                    <select
                      {...props}
                      className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                      onChange={(event) => {
                        setRefundMethod(event.target.value as PaymentMethod);
                        setRefundCashSession("");
                      }}
                      value={refundMethod}
                    >
                      <option value="">Selecciona método</option>
                      {(methods.data ?? []).map((method) => (
                        <option key={method.method} value={method.method}>{method.label}</option>
                      ))}
                    </select>
                  )}
              </FormField>
              {refundMethod === "cash" ? (
                <FormField label="Caja abierta del administrador" required>
                  {(props) => (
                    <select
                      {...props}
                      className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                      onChange={(event) => setRefundCashSession(event.target.value)}
                      value={refundCashSession}
                    >
                      <option value="">Selecciona caja</option>
                      {(cashSessions.data ?? []).map((session) => (
                        <option key={session.id} value={session.id}>{session.id.slice(0, 8)}</option>
                      ))}
                    </select>
                  )}
                </FormField>
              ) : null}
              <FormField
                description="Para pagos por transferencia/tarjeta, procesa el reembolso en el proveedor externo; aquí queda la autorización y trazabilidad."
                label="Motivo"
                required
              >
                {(props) => (
                  <textarea
                    {...props}
                    className="min-h-20 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                    maxLength={500}
                    onChange={(event) => setReverseReason(event.target.value)}
                    value={reverseReason}
                  />
                )}
              </FormField>
              <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
                <input
                  checked={restoreInventory}
                  onChange={(event) => setRestoreInventory(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  Restablecer existencias solo si los productos/materiales devueltos fueron recibidos y son reutilizables.
                  {reverseTarget.items.some((item) => item.item_type === "recipe")
                    ? " No marques esta opción si la réplica o sus materiales fueron usados."
                    : ""}
                </span>
              </label>
              {refundMethod && refundMethod !== "cash" ? (
                <p className="text-xs text-amber-800">
                  La aplicación registra la reversión; completa la operación monetaria por este método fuera del sistema si aplica.
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button onClick={() => setReverseTarget(null)} type="button" variant="outline">Cancelar</Button>
                <Button
                  className={reverseOperation === "void" ? "bg-red-700 text-white hover:bg-red-800" : ""}
                  disabled={reverseMutation.isPending}
                  type="submit"
                  variant="default"
                >
                  {reverseMutation.isPending ? "Registrando…" : reverseOperation === "void" ? "Confirmar anulación" : "Confirmar devolución"}
                </Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface PaymentMethodOptionForm {
  method: PaymentMethod;
  label: string;
  enabled: boolean;
}

function ProductChoice({
  product,
  onAdd,
  disabled = false,
}: {
  product: RetailProduct;
  onAdd: () => void;
  disabled?: boolean;
}) {
  const available = product.stock_qty > 0;
  return (
    <button
      className="flex min-h-36 flex-col justify-between rounded-xl border border-border p-4 text-left transition hover:border-gold/60 hover:bg-gold/5 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={!available || disabled}
      onClick={onAdd}
      type="button"
    >
      <span className="flex items-start justify-between gap-2">
        <span>
          <span className="block font-medium">{product.name}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{product.brand} · {product.size_ml ?? "—"} ml</span>
          <span className="mt-1 block text-xs text-muted-foreground">SKU {product.sku}</span>
        </span>
        <PackagePlus aria-hidden="true" className="shrink-0 text-gold" size={17} />
      </span>
      <span className="mt-4 flex items-end justify-between gap-2">
        <span className="font-semibold">{formatCop(product.price_cop)}</span>
        <span className={`text-xs ${available ? "text-muted-foreground" : "text-red-700"}`}>
          {formatQuantity(product.stock_qty)} un.
        </span>
      </span>
    </button>
  );
}

function SalesLoadError({
  details,
  onRetry,
}: {
  details: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center gap-3 py-12 text-center"
      role="alert"
    >
      <AlertCircle aria-hidden="true" className="text-red-700" size={22} />
      <p className="max-w-lg text-sm text-muted-foreground">{details}</p>
      <Button onClick={onRetry} variant="outline">
        Reintentar
      </Button>
    </div>
  );
}

function RecipeChoice({
  recipe,
  onAdd,
  disabled = false,
}: {
  recipe: Recipe;
  onAdd: () => void;
  disabled?: boolean;
}) {
  const available = availableFor({
    key: "",
    kind: "recipe",
    id: recipe.id,
    quantity: 1,
    fill_consumption_ml: null,
  }, [], [recipe]) > 0;
  const needsMeasuredFill = recipe.recipe_components.some(
    (component) => component.mode === "fill_to_volume",
  );
  return (
    <button
      className="flex min-h-40 flex-col justify-between rounded-xl border border-border p-4 text-left transition hover:border-gold/60 hover:bg-gold/5"
      disabled={disabled}
      onClick={onAdd}
      type="button"
    >
      <span className="flex items-start justify-between gap-2">
        <span>
          <span className="block font-medium">{recipe.perfumes?.name ?? "Perfume"}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{recipe.perfumes?.brand} · {recipe.size_ml} ml · versión {recipe.version}</span>
          <span className="mt-2 block text-xs text-muted-foreground">
            {needsMeasuredFill ? "Requiere medición real de componente variable" : "Fórmula fija"}
          </span>
        </span>
        <CircleDollarSign aria-hidden="true" className="shrink-0 text-gold" size={17} />
      </span>
      <span className="mt-4 flex items-end justify-between gap-2">
        <span className="font-semibold">{formatCop(recipe.price_cop)}</span>
        <span className="text-xs text-muted-foreground">
          {available ? "Materiales a validar" : "Existencias insuficientes"}
        </span>
      </span>
    </button>
  );
}
