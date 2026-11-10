import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Building2, Pencil, Plus, Search } from "lucide-react";
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
import { fetchSuppliers, inventoryQueryKeys } from "@/features/inventory/data";
import type { Supplier } from "@/features/inventory/types";
import { supabase } from "@/lib/supabase";
import { notify } from "@/lib/notifications";

const supplierSchema = z.object({
  name: z.string().trim().min(1, "Ingresa la razón social o nombre.").max(180),
  tax_id: z.string().trim().max(80),
  contact_name: z.string().trim().max(160),
  phone: z.string().trim().max(40),
  email: z.union([z.literal(""), z.string().trim().email("Ingresa un correo válido.")]),
  notes: z.string().trim().max(1000),
  active: z.enum(["true", "false"]),
});

type SupplierValues = z.infer<typeof supplierSchema>;

const emptyValues: SupplierValues = {
  name: "",
  tax_id: "",
  contact_name: "",
  phone: "",
  email: "",
  notes: "",
  active: "true",
};

function SupplierDialog({
  open,
  onOpenChange,
  supplier,
  onSave,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: Supplier | null;
  onSave: (values: SupplierValues) => Promise<void>;
  isSaving: boolean;
}) {
  const formValues = useMemo<SupplierValues>(
    () =>
      supplier
        ? {
            name: supplier.name,
            tax_id: supplier.tax_id ?? "",
            contact_name: supplier.contact_name ?? "",
            phone: supplier.phone ?? "",
            email: supplier.email ?? "",
            notes: supplier.notes ?? "",
            active: String(supplier.active) as "true" | "false",
          }
        : emptyValues,
    [supplier],
  );
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SupplierValues>({
    resolver: zodResolver(supplierSchema),
    defaultValues: emptyValues,
    values: formValues,
  });

  async function submit(values: SupplierValues) {
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
            {supplier ? "Editar proveedor" : "Nuevo proveedor"}
          </DialogTitle>
          <DialogDescription>
            Los proveedores con compras u otros movimientos relacionados se
            conservan en el historial y no se eliminan físicamente.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit(submit)}>
          <FormField
            className="sm:col-span-2"
            label="Nombre / razón social"
            error={errors.name?.message}
            required
          >
            {(props) => <Input autoComplete="organization" {...props} {...register("name")} />}
          </FormField>
          <FormField label="NIT (opcional)">
            {(props) => <Input {...props} {...register("tax_id")} />}
          </FormField>
          <FormField label="Persona de contacto">
            {(props) => <Input autoComplete="name" {...props} {...register("contact_name")} />}
          </FormField>
          <FormField label="Teléfono">
            {(props) => (
              <Input
                autoComplete="tel"
                inputMode="tel"
                type="tel"
                {...props}
                {...register("phone")}
              />
            )}
          </FormField>
          <FormField label="Correo" error={errors.email?.message}>
            {(props) => (
              <Input
                autoComplete="email"
                type="email"
                {...props}
                {...register("email")}
              />
            )}
          </FormField>
          <FormField className="sm:col-span-2" label="Notas">
            {(props) => <Textarea {...props} {...register("notes")} />}
          </FormField>
          {supplier ? (
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
              {isSaving ? "Guardando…" : "Guardar proveedor"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SuppliersPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [search, setSearch] = useState("");
  const suppliers = useQuery({
    queryKey: inventoryQueryKeys.suppliers,
    queryFn: fetchSuppliers,
  });
  const saveSupplier = useMutation({
    mutationFn: async (values: SupplierValues) => {
      if (!supabase) throw new Error("Supabase no está conectado.");
      const payload = {
        name: values.name,
        tax_id: values.tax_id || null,
        contact_name: values.contact_name || null,
        phone: values.phone || null,
        email: values.email || null,
        notes: values.notes || null,
        active: values.active !== "false",
      };
      const request = editing
        ? supabase
            .from("suppliers")
            .update(payload)
            .eq("id", editing.id)
            .select("id")
            .single()
        : supabase.from("suppliers").insert(payload).select("id").single();
      const { error } = await request;
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.suppliers }),
        queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.products }),
        queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.materials }),
        queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.purchases }),
      ]);
      setDialogOpen(false);
      setEditing(null);
      notify.success("Proveedor guardado.");
    },
    onError: (error) => notify.error(error.message),
  });
  const filtered = (suppliers.data ?? []).filter((supplier) =>
    `${supplier.name} ${supplier.tax_id ?? ""} ${supplier.contact_name ?? ""}`
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
            Nuevo proveedor
          </Button>
        }
        description="Directorio de proveedores para productos terminados y materias primas. Los registros relacionados con compras se desactivan, no se borran."
        eyebrow="Abastecimiento"
        title="Proveedores"
      />
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 aria-hidden="true" className="text-gold" size={17} />
            Directorio
          </CardTitle>
          <div className="relative min-w-52">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={15}
            />
            <Input
              aria-label="Buscar proveedores"
              className="pl-9"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre, NIT o contacto"
              value={search}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {suppliers.isLoading ? (
            <LoadingState />
          ) : suppliers.isError ? (
            <ErrorState onRetry={() => void suppliers.refetch()} />
          ) : filtered.length === 0 ? (
            <EmptyState
              description="Agrega los proveedores de tus productos y materiales."
              title="No hay proveedores para mostrar"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead>Teléfono / correo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((supplier) => (
                  <TableRow key={supplier.id}>
                    <TableCell>
                      <div className="font-medium">{supplier.name}</div>
                      {supplier.tax_id ? (
                        <div className="text-xs text-muted-foreground">
                          NIT {supplier.tax_id}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>{supplier.contact_name || "—"}</TableCell>
                    <TableCell>
                      <div>{supplier.phone || "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {supplier.email || ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          supplier.active
                            ? "rounded-full bg-green-50 px-2 py-1 text-xs text-green-800"
                            : "rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"
                        }
                      >
                        {supplier.active ? "Activo" : "Inactivo"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        aria-label={`Editar ${supplier.name}`}
                        onClick={() => {
                          setEditing(supplier);
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
      <SupplierDialog
        isSaving={saveSupplier.isPending}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        onSave={(values) => saveSupplier.mutateAsync(values)}
        open={dialogOpen}
        supplier={editing}
      />
    </div>
  );
}
