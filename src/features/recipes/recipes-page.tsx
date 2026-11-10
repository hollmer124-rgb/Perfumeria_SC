import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CirclePlus, FlaskConical, Pencil, Play, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/features/auth/use-auth";
import { EmptyState, ErrorState, LoadingState, PageHeading } from "@/features/inventory/components";
import { formatCop, formatQuantity } from "@/features/inventory/format";
import { estimateRecipeCost } from "@/features/recipes/costing";
import {
  activateRecipe,
  createRecipeVersion,
  fetchOpenCashSessions,
  fetchRecipeCosts,
  fetchRecipeCustomers,
  fetchRecipeMaterials,
  fetchRecipePerfumes,
  fetchRecipes,
  manufactureRecipe,
  recipeQueryKeys,
  saveRecipe,
} from "@/features/recipes/data";
import { ManufactureDialog } from "@/features/recipes/manufacture-dialog";
import { RecipeFormDialog } from "@/features/recipes/recipe-form-dialog";
import type { Recipe, RecipeSaveInput } from "@/features/recipes/types";
import { notify } from "@/lib/notifications";
import { fetchPaymentMethods, salesQueryKeys } from "@/features/sales/data";

const unitLabels: Record<string, string> = {
  g: "g",
  ml: "ml",
  unit: "unidades",
  dose: "dosis",
};

function recipeLabel(recipe: Recipe) {
  return `${recipe.perfumes?.brand ?? "Perfume"} · ${recipe.perfumes?.name ?? "Sin nombre"} · ${recipe.size_ml} ml`;
}

function statusLabel(status: Recipe["status"]) {
  return {
    active: "Activa",
    draft: "Borrador",
    archived: "Archivada",
  }[status];
}

export function RecipesPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [manufacturingRecipe, setManufacturingRecipe] = useState<Recipe | null>(null);

  const recipes = useQuery({
    queryKey: recipeQueryKeys.recipes,
    queryFn: fetchRecipes,
  });
  const materials = useQuery({
    queryKey: recipeQueryKeys.materials,
    queryFn: fetchRecipeMaterials,
  });
  const perfumes = useQuery({
    queryKey: recipeQueryKeys.perfumes,
    queryFn: fetchRecipePerfumes,
  });
  const costs = useQuery({
    queryKey: recipeQueryKeys.costs,
    queryFn: fetchRecipeCosts,
    enabled: isAdmin,
  });
  const customers = useQuery({
    queryKey: recipeQueryKeys.customers,
    queryFn: fetchRecipeCustomers,
  });
  const cashSessions = useQuery({
    queryKey: [...recipeQueryKeys.cashSessions, profile?.id],
    queryFn: () => fetchOpenCashSessions(profile?.id ?? ""),
    enabled: Boolean(profile?.id),
  });
  const paymentMethods = useQuery({
    queryKey: salesQueryKeys.paymentMethods,
    queryFn: fetchPaymentMethods,
  });

  const invalidateRecipes = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: recipeQueryKeys.recipes }),
      queryClient.invalidateQueries({ queryKey: recipeQueryKeys.materials }),
      queryClient.invalidateQueries({ queryKey: recipeQueryKeys.costs }),
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: (values: RecipeSaveInput) => saveRecipe(values),
    onSuccess: async () => {
      await invalidateRecipes();
      setEditorOpen(false);
      setEditingRecipe(null);
      notify.success("Borrador de receta guardado.");
    },
    onError: (error) => notify.error(error.message),
  });
  const activateMutation = useMutation({
    mutationFn: activateRecipe,
    onSuccess: async () => {
      await invalidateRecipes();
      notify.success("Receta activada. La versión anterior queda en el historial.");
    },
    onError: (error) => notify.error(error.message),
  });
  const versionMutation = useMutation({
    mutationFn: createRecipeVersion,
    onSuccess: async (newId) => {
      await invalidateRecipes();
      const refreshed = await queryClient.fetchQuery({
        queryKey: recipeQueryKeys.recipes,
        queryFn: fetchRecipes,
      });
      setEditingRecipe(refreshed.find((recipe) => recipe.id === newId) ?? null);
      setEditorOpen(true);
      notify.success("Se creó una nueva versión en borrador.");
    },
    onError: (error) => notify.error(error.message),
  });
  const manufactureMutation = useMutation({
    mutationFn: manufactureRecipe,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: recipeQueryKeys.recipes }),
        queryClient.invalidateQueries({ queryKey: recipeQueryKeys.materials }),
        queryClient.invalidateQueries({ queryKey: ["inventory-movements"] }),
        queryClient.invalidateQueries({ queryKey: recipeQueryKeys.costs }),
        queryClient.invalidateQueries({ queryKey: ["recipe-open-cash-sessions"] }),
      ]);
      setManufacturingRecipe(null);
      notify.success("Fabricación y venta registradas; se actualizaron las existencias.");
    },
    onError: (error) => notify.error(error.message),
  });

  const visibleRecipes = useMemo(() => {
    const text = search.trim().toLocaleLowerCase("es-CO");
    return (recipes.data ?? []).filter((recipe) => {
      const matchesSearch = `${recipe.perfumes?.brand ?? ""} ${recipe.perfumes?.name ?? ""} ${recipe.size_ml} ml`
        .toLocaleLowerCase("es-CO")
        .includes(text);
      return matchesSearch && (isAdmin || recipe.status === "active");
    });
  }, [isAdmin, recipes.data, search]);

  const loading =
    recipes.isLoading ||
    materials.isLoading ||
    perfumes.isLoading ||
    customers.isLoading ||
    cashSessions.isLoading ||
    paymentMethods.isLoading ||
    (isAdmin && costs.isLoading);
  const hasError =
    recipes.isError ||
    materials.isError ||
    perfumes.isError ||
    customers.isError ||
    cashSessions.isError ||
    paymentMethods.isError ||
    (isAdmin && costs.isError);
  const activeCount = (recipes.data ?? []).filter((recipe) => recipe.status === "active").length;
  const draftCount = (recipes.data ?? []).filter((recipe) => recipe.status === "draft").length;

  return (
    <div className="space-y-7">
      <PageHeading
        action={isAdmin ? (
          <Button
            onClick={() => {
              setEditingRecipe(null);
              setEditorOpen(true);
            }}
          >
            <CirclePlus aria-hidden="true" size={16} />
            Nueva fórmula
          </Button>
        ) : null}
        description={
          isAdmin
            ? "Configura fórmulas independientes por perfume y presentación. Las versiones activas se conservan como historial."
            : "Consulta las fórmulas activas para preparar réplicas únicamente cuando exista un pedido."
        }
        eyebrow="Fórmulas y preparación"
        title="Recetas"
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Presentaciones activas" value={activeCount} />
        {isAdmin ? <SummaryCard label="Borradores" value={draftCount} /> : null}
        <SummaryCard label="Materiales disponibles" value={(materials.data ?? []).length} />
      </div>

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Fórmulas por presentación</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Cantidades fijas conservan su unidad; el consumo de fill_to_volume se registra al fabricar.
            </p>
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
            <Input
              aria-label="Buscar recetas"
              className="pl-9"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Perfume o presentación"
              value={search}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <LoadingState label="Cargando recetas y materiales…" />
          ) : hasError ? (
            <ErrorState onRetry={() => {
              void recipes.refetch();
              void materials.refetch();
              void perfumes.refetch();
              void customers.refetch();
              void cashSessions.refetch();
              if (isAdmin) void costs.refetch();
            }} />
          ) : visibleRecipes.length === 0 ? (
            <EmptyState
              description={
                isAdmin
                  ? "Crea fórmulas por presentación. El seed DEMO incluye Winner Sport de 30 ml como borrador configurable."
                  : "No hay fórmulas activas disponibles para consulta."
              }
              title="No hay recetas para mostrar"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Perfume / presentación</TableHead>
                  <TableHead>Componentes</TableHead>
                  <TableHead>Versión</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Precio de venta</TableHead>
                  {isAdmin ? <TableHead className="text-right">Costo / utilidad estimados</TableHead> : null}
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRecipes.map((recipe) => {
                  const estimatedCost = isAdmin
                    ? estimateRecipeCost(recipe, costs.data ?? [])
                    : null;
                  const hasFill = recipe.recipe_components.some((component) => component.mode === "fill_to_volume");
                  const bottleComponents = recipe.recipe_components.filter(
                    (component) => component.materials?.category === "bottle",
                  );
                  const hasMatchingBottle = bottleComponents.length === 1 && bottleComponents.filter(
                    (component) =>
                      component.materials?.category === "bottle" &&
                      component.materials.size_ml === recipe.size_ml &&
                      component.mode === "fixed" &&
                      component.quantity === 1,
                  ).length === 1;
                  const estimatedProfit = estimatedCost === null ? null : recipe.price_cop - estimatedCost;
                  const margin = estimatedCost === null || recipe.price_cop === 0
                    ? null
                    : (estimatedProfit! / recipe.price_cop) * 100;
                  return (
                    <TableRow key={recipe.id}>
                      <TableCell className="min-w-52">
                        <p className="font-medium">{recipe.perfumes?.name ?? "Perfume sin nombre"}</p>
                        <p className="text-xs text-muted-foreground">
                          {recipe.perfumes?.brand ?? "—"} · {recipe.size_ml} ml
                        </p>
                      </TableCell>
                      <TableCell className="min-w-64">
                        <ul className="space-y-1">
                          {recipe.recipe_components.map((component) => (
                            <li className="text-xs" key={component.id}>
                              <span className="font-medium">{component.materials?.name ?? "Material no disponible"}</span>
                              <span className="text-muted-foreground">
                                {" · "}
                                {component.materials?.category === "bottle"
                                  ? `frasco ${component.materials.size_ml ?? "sin tamaño"} ml · ${formatQuantity(component.quantity ?? 0)} unidad`
                                  : component.mode === "fill_to_volume"
                                  ? "consumo medido al fabricar"
                                  : `${formatQuantity(component.quantity ?? 0)} ${component.materials ? unitLabels[component.materials.base_unit] : ""}`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                      <TableCell>v{recipe.version}</TableCell>
                      <TableCell>
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs ${
                          recipe.status === "active"
                            ? "bg-emerald-50 text-emerald-800"
                            : recipe.status === "draft"
                              ? "bg-amber-50 text-amber-800"
                              : "bg-muted text-muted-foreground"
                        }`}>
                          {statusLabel(recipe.status)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatCop(recipe.price_cop)}</TableCell>
                      {isAdmin ? (
                        <TableCell className="text-right">
                          {estimatedCost === null ? (
                            <span className="text-xs text-muted-foreground">
                              {hasFill
                                ? "Costo, utilidad y margen al medir"
                                : "Costo no disponible"}
                            </span>
                          ) : (
                            <>
                              <p className="text-sm">{formatCop(estimatedCost)}</p>
                              <p className={`text-xs ${estimatedProfit! < 0 ? "text-red-700" : "text-muted-foreground"}`}>
                                Utilidad {formatCop(estimatedProfit!)} · Margen {margin?.toLocaleString("es-CO", { maximumFractionDigits: 1 })}%
                              </p>
                            </>
                          )}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          {recipe.status === "active" ? (
                            <Button
                              disabled={!hasMatchingBottle}
                              onClick={() => setManufacturingRecipe(recipe)}
                              size="sm"
                              variant="outline"
                            >
                              <FlaskConical aria-hidden="true" size={14} />
                              Fabricar
                            </Button>
                          ) : null}
                          {isAdmin && recipe.status === "draft" ? (
                            <>
                              <Button
                                aria-label={`Editar ${recipeLabel(recipe)}`}
                                onClick={() => {
                                  setEditingRecipe(recipe);
                                  setEditorOpen(true);
                                }}
                                size="icon"
                                variant="ghost"
                              >
                                <Pencil aria-hidden="true" size={15} />
                              </Button>
                              <Button
                                disabled={activateMutation.isPending || recipe.recipe_components.length === 0 || !hasMatchingBottle}
                                onClick={() => activateMutation.mutate(recipe.id)}
                                size="sm"
                                variant="outline"
                              >
                                <Play aria-hidden="true" size={14} />
                                Activar
                              </Button>
                            </>
                          ) : null}
                          {isAdmin && recipe.status === "draft" && !hasMatchingBottle ? (
                            <span className="self-center text-xs text-amber-800">
                              Requiere exactamente 1 frasco de {recipe.size_ml} ml
                            </span>
                          ) : null}
                          {isAdmin && recipe.status === "active" ? (
                            <Button
                              disabled={versionMutation.isPending}
                              onClick={() => versionMutation.mutate(recipe.id)}
                              size="sm"
                              variant="ghost"
                            >
                              <BadgeCheck aria-hidden="true" size={14} />
                              Nueva versión
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {isAdmin ? (
        <RecipeFormDialog
          key={`${editingRecipe?.id ?? "new"}-${editorOpen}`}
          isSaving={saveMutation.isPending}
          materials={materials.data ?? []}
          onOpenChange={setEditorOpen}
          onSave={async (values) => {
            await saveMutation.mutateAsync(values);
          }}
          open={editorOpen}
          perfumes={perfumes.data ?? []}
          recipe={editingRecipe}
        />
      ) : null}
      <ManufactureDialog
        cashSessions={cashSessions.data ?? []}
        costs={isAdmin ? costs.data ?? [] : []}
        customers={customers.data ?? []}
        paymentMethods={paymentMethods.data ?? []}
        isSaving={manufactureMutation.isPending}
        onManufacture={async (input) => {
          await manufactureMutation.mutateAsync(input);
        }}
        onOpenChange={(open) => {
          if (!open) setManufacturingRecipe(null);
        }}
        open={Boolean(manufacturingRecipe)}
        recipe={manufacturingRecipe}
        showFinancials={isAdmin}
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 py-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="font-serif text-2xl font-semibold">{value}</span>
      </CardContent>
    </Card>
  );
}
