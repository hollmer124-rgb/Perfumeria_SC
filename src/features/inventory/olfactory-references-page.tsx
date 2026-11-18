import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Pencil, Plus, Search, Sparkles } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeading,
} from "@/features/inventory/components";
import {
  fetchPerfumes,
  inventoryQueryKeys,
  savePerfumeReference,
} from "@/features/inventory/data";
import type { Perfume } from "@/features/inventory/types";
import { operationErrorMessage } from "@/lib/operation-error";
import { notify } from "@/lib/notifications";

const referenceSchema = z.object({
  name: z.string().trim().min(1, "Ingresa el nombre de la referencia.").max(160),
  brand: z.string().trim().min(1, "Ingresa la marca.").max(120),
  description: z.string().trim(),
  active: z.enum(["true", "false"]),
});

type ReferenceValues = z.infer<typeof referenceSchema>;

const emptyValues: ReferenceValues = {
  name: "",
  brand: "",
  description: "",
  active: "true",
};

function referenceErrorMessage(error: unknown): string {
  const record =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : null;
  if (record?.code === "23505") {
    return "Ya existe una referencia con esta marca y este nombre.";
  }
  if (record?.code === "55000") {
    return "No se puede desactivar una referencia con recetas activas.";
  }
  return operationErrorMessage(
    error,
    "No se pudo guardar la referencia olfativa.",
    "Olfactory reference save failed",
  );
}

function ReferenceDialog({
  open,
  onOpenChange,
  reference,
  onSave,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reference: Perfume | null;
  onSave: (values: ReferenceValues) => Promise<void>;
  isSaving: boolean;
}) {
  const formValues = useMemo<ReferenceValues>(
    () =>
      reference
        ? {
            name: reference.name,
            brand: reference.brand,
            description: reference.description ?? "",
            active: String(reference.active) as "true" | "false",
          }
        : emptyValues,
    [reference],
  );
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ReferenceValues>({
    resolver: zodResolver(referenceSchema),
    defaultValues: emptyValues,
    values: formValues,
  });

  async function submit(values: ReferenceValues) {
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
            {reference ? "Editar referencia olfativa" : "Nueva referencia olfativa"}
          </DialogTitle>
          <DialogDescription>
            Una referencia identifica un aroma; no crea productos ni existencias.
            Las fórmulas relacionan las referencias con los materiales que consumen.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(submit)}>
          <FormField label="Nombre" error={errors.name?.message} required>
            {(props) => <Input {...props} {...register("name")} />}
          </FormField>
          <FormField label="Marca" error={errors.brand?.message} required>
            {(props) => <Input {...props} {...register("brand")} />}
          </FormField>
          <FormField className="sm:col-span-2" label="Descripción">
            {(props) => <Textarea {...props} {...register("description")} />}
          </FormField>
          {reference ? (
            <FormField label="Estado">
              {(props) => (
                <select
                  className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
                  {...props}
                  {...register("active")}
                >
                  <option value="true">Activa</option>
                  <option value="false">Inactiva</option>
                </select>
              )}
            </FormField>
          ) : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
              Cancelar
            </Button>
            <Button disabled={isSaving} type="submit">
              {isSaving ? "Guardando…" : "Guardar referencia"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OlfactoryReferencesPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Perfume | null>(null);
  const [search, setSearch] = useState("");
  const references = useQuery({
    queryKey: inventoryQueryKeys.perfumes,
    queryFn: fetchPerfumes,
  });
  const saveReference = useMutation({
    mutationFn: (values: ReferenceValues) =>
      savePerfumeReference(editing?.id ?? null, {
        name: values.name,
        brand: values.brand,
        description: values.description || null,
        active: values.active !== "false",
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.perfumes }),
        queryClient.invalidateQueries({ queryKey: ["recipes"] }),
      ]);
      setDialogOpen(false);
      setEditing(null);
      notify.success("Referencia olfativa guardada.");
    },
    onError: (error) => notify.error(referenceErrorMessage(error)),
  });
  const filtered = (references.data ?? []).filter((reference) =>
    `${reference.name} ${reference.brand}`
      .toLocaleLowerCase("es-CO")
      .includes(search.toLocaleLowerCase("es-CO")),
  );

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
            Nueva referencia
          </Button>
        }
        description="Administra nombres y marcas de aromas independientemente del inventario y los productos comercializables."
        eyebrow="Catálogo"
        title="Referencias olfativas"
      />
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles aria-hidden="true" className="text-gold" size={17} />
            Aromas registrados
          </CardTitle>
          <div className="relative min-w-52">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={15}
            />
            <Input
              aria-label="Buscar referencias olfativas"
              className="pl-9"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre o marca"
              value={search}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {references.isLoading ? (
            <LoadingState label="Cargando referencias…" />
          ) : references.isError ? (
            <ErrorState onRetry={() => void references.refetch()} />
          ) : filtered.length === 0 ? (
            <EmptyState
              description={
                search
                  ? "Prueba con otro nombre o marca."
                  : "Registra una referencia sin crear un producto terminado."
              }
              title={search ? "No hay coincidencias" : "Aún no hay referencias"}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Marca</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((reference) => (
                  <TableRow key={reference.id}>
                    <TableCell className="font-medium">{reference.name}</TableCell>
                    <TableCell>{reference.brand}</TableCell>
                    <TableCell className="max-w-72 truncate text-muted-foreground">
                      {reference.description || "—"}
                    </TableCell>
                    <TableCell>{reference.active ? "Activa" : "Inactiva"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        aria-label={`Editar ${reference.name}`}
                        onClick={() => {
                          setEditing(reference);
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
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <ReferenceDialog
        isSaving={saveReference.isPending}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        onSave={(values) => saveReference.mutateAsync(values)}
        open={dialogOpen}
        reference={editing}
      />
    </div>
  );
}
