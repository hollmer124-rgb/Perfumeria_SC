import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Clock3, Eye, Pencil, Plus, Search, UserRound } from "lucide-react";
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
  customerQueryKeys,
  fetchCustomerPage,
  fetchCustomerSales,
  hasPossibleCustomerDuplicate,
  type Customer,
} from "@/features/customers/data";
import type { CustomerValues } from "@/features/customers/types";
import { useAuth } from "@/features/auth/use-auth";
import { supabase } from "@/lib/supabase";
import { notify } from "@/lib/notifications";
import { operationErrorMessage } from "@/lib/operation-error";
import { formatCop } from "@/features/inventory/format";

const PAGE_SIZE = 25;

const customerSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(1, "Ingresa el nombre del cliente.")
    .max(160, "El nombre no puede superar 160 caracteres."),
  phone: z.string().trim(),
  email: z.union([
    z.literal(""),
    z.string().trim().email("Ingresa un correo válido."),
  ]),
  notes: z.string().trim(),
});

const emptyValues: CustomerValues = {
  full_name: "",
  phone: "",
  email: "",
  notes: "",
};

const dateFormatter = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "short",
});

function CustomerDialog({
  open,
  onOpenChange,
  customer,
  onSave,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer | null;
  onSave: (values: CustomerValues) => Promise<void>;
  isSaving: boolean;
}) {
  const formValues = useMemo<CustomerValues>(
    () =>
      customer
        ? {
            full_name: customer.full_name,
            phone: customer.phone ?? "",
            email: customer.email ?? "",
            notes: customer.notes ?? "",
          }
        : emptyValues,
    [customer],
  );
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CustomerValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: emptyValues,
    values: formValues,
  });

  async function submit(values: CustomerValues) {
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
            {customer ? "Editar cliente" : "Nuevo cliente"}
          </DialogTitle>
          <DialogDescription>
            Los campos de propiedad no se pueden editar. Los cambios se guardan
            según los permisos de tu cuenta.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={handleSubmit(submit)}
        >
          <FormField
            className="sm:col-span-2"
            label="Nombre completo"
            error={errors.full_name?.message}
            required
          >
            {(props) => (
              <Input autoComplete="name" {...props} {...register("full_name")} />
            )}
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
          {customer ? (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Creado el {dateFormatter.format(new Date(customer.created_at))}.
              {" "}El registro y su historial de ventas se conservan.
            </p>
          ) : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancelar
            </Button>
            <Button disabled={isSaving} type="submit">
              {isSaving ? "Guardando…" : "Guardar cliente"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CustomerDetails({
  customer,
  open,
  onOpenChange,
  canEdit,
  onEdit,
}: {
  customer: Customer | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const sales = useQuery({
    queryKey: customerQueryKeys.sales(customer?.id ?? ""),
    queryFn: () => fetchCustomerSales(customer!.id),
    enabled: open && Boolean(customer),
  });
  const saleRows = sales.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{customer?.full_name ?? "Cliente"}</DialogTitle>
          <DialogDescription>
            Datos del cliente e historial visible para tu cuenta.
          </DialogDescription>
        </DialogHeader>
        {customer ? (
          <div className="space-y-6">
            <dl className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Teléfono</dt>
                <dd className="mt-1 text-sm">{customer.phone || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Correo</dt>
                <dd className="mt-1 break-all text-sm">{customer.email || "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Notas</dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm">
                  {customer.notes || "—"}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Cliente desde</dt>
                <dd className="mt-1 text-sm">
                  {dateFormatter.format(new Date(customer.created_at))}
                </dd>
              </div>
            </dl>
            <section aria-labelledby="customer-sales-title" className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3
                  className="font-serif text-lg font-semibold"
                  id="customer-sales-title"
                >
                  Compras recientes
                </h3>
                {canEdit ? (
                  <Button onClick={onEdit} size="sm" variant="outline">
                    <Pencil aria-hidden="true" size={14} />
                    Editar cliente
                  </Button>
                ) : null}
              </div>
              {sales.isLoading ? (
                <LoadingState />
              ) : sales.isError ? (
                <ErrorState onRetry={() => void sales.refetch()} />
              ) : saleRows.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                  No hay ventas visibles asociadas a este cliente.
                </p>
              ) : (
                <div className="max-h-64 overflow-auto rounded-xl border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Venta</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {saleRows.map((sale) => (
                        <TableRow key={sale.id}>
                          <TableCell>#{sale.sale_number}</TableCell>
                          <TableCell>
                            {dateFormatter.format(new Date(sale.created_at))}
                          </TableCell>
                          <TableCell>{sale.status}</TableCell>
                          <TableCell className="text-right">
                            {formatCop(Number(sale.total_cop))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {saleRows.length === 50 ? (
                <p className="text-xs text-muted-foreground">
                  Se muestran las 50 ventas más recientes visibles.
                </p>
              ) : null}
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function CustomersPage() {
  const { profile, session } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [settledSearch, setSettledSearch] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettledSearch(search);
      setPage(0);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const customers = useQuery({
    queryKey: customerQueryKeys.page(settledSearch, page),
    queryFn: () => fetchCustomerPage(settledSearch, page, PAGE_SIZE),
  });
  const customerRows = customers.data?.rows ?? [];
  const canEdit = Boolean(
    selected &&
      (profile?.role === "admin" || selected.created_by === session?.user.id),
  );

  const saveCustomer = useMutation({
    mutationFn: async (values: CustomerValues) => {
      if (!supabase || !session?.user.id) {
        throw new Error("Se requiere una sesión autenticada para guardar clientes.");
      }
      const email = values.email.trim().toLocaleLowerCase("es-CO") || null;
      const phone = values.phone.trim() || null;
      if (
        await hasPossibleCustomerDuplicate(email, phone, editing?.id)
      ) {
        notify.info(
          "Ya existe un cliente con el mismo correo o teléfono. Se guardará igualmente porque el sistema permite datos compartidos.",
        );
      }
      const payload = {
        full_name: values.full_name.trim(),
        email,
        phone,
        notes: values.notes.trim() || null,
      };
      const request = editing
        ? supabase
            .from("customers")
            .update(payload)
            .eq("id", editing.id)
            .select("id")
            .single()
        : supabase
            .from("customers")
            .insert({ ...payload, created_by: session.user.id })
            .select("id")
            .single();
      const { error } = await request;
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: customerQueryKeys.all });
      setDialogOpen(false);
      setEditing(null);
      notify.success("Cliente guardado.");
    },
    onError: (error) =>
      notify.error(
        operationErrorMessage(
          error,
          "No se pudo guardar el cliente. Comprueba tus permisos e inténtalo de nuevo.",
          "Customer save failed",
        ),
      ),
  });

  const totalPages = Math.ceil((customers.data?.total ?? 0) / PAGE_SIZE);

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
            Nuevo cliente
          </Button>
        }
        description="Directorio de clientes, datos de contacto e historial de ventas. No se eliminan registros que puedan estar relacionados con operaciones."
        eyebrow="Directorio"
        title="Clientes"
      />
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserRound aria-hidden="true" className="text-gold" size={17} />
            Clientes registrados
            {customers.data ? (
              <span className="text-sm font-normal text-muted-foreground">
                ({customers.data.total})
              </span>
            ) : null}
          </CardTitle>
          <div className="relative min-w-52">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={15}
            />
            <Input
              aria-label="Buscar clientes"
              className="pl-9"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre, teléfono o correo"
              value={search}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {customers.isLoading ? (
            <LoadingState />
          ) : customers.isError ? (
            <ErrorState onRetry={() => void customers.refetch()} />
          ) : customerRows.length === 0 ? (
            <EmptyState
              description={
                settledSearch
                  ? "Prueba con otros términos de búsqueda."
                  : "Registra el primer cliente para usarlo también en el punto de venta."
              }
              title={
                settledSearch
                  ? "No se encontraron coincidencias"
                  : "Aún no hay clientes"
              }
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Teléfono / correo</TableHead>
                    <TableHead>Registrado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerRows.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell className="font-medium">
                        {customer.full_name}
                      </TableCell>
                      <TableCell>
                        <div>{customer.phone || "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {customer.email || ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock3 aria-hidden="true" size={13} />
                          {new Intl.DateTimeFormat("es-CO", {
                            dateStyle: "medium",
                          }).format(new Date(customer.created_at))}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-2">
                          <Button
                            aria-label={`Ver ${customer.full_name}`}
                            onClick={() => {
                              setSelected(customer);
                              setDetailsOpen(true);
                            }}
                            size="sm"
                            variant="outline"
                          >
                            <Eye aria-hidden="true" size={14} />
                            Ver
                          </Button>
                          {profile?.role === "admin" ||
                          customer.created_by === session?.user.id ? (
                            <Button
                              aria-label={`Editar ${customer.full_name}`}
                              onClick={() => {
                                setEditing(customer);
                                setDialogOpen(true);
                              }}
                              size="sm"
                              variant="outline"
                            >
                              <Pencil aria-hidden="true" size={14} />
                              Editar
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
                <p aria-live="polite" className="text-xs text-muted-foreground">
                  Página {page + 1} de {Math.max(totalPages, 1)}
                  {customers.isFetching ? " · Actualizando…" : ""}
                </p>
                <div className="flex gap-2">
                  <Button
                    disabled={page === 0 || customers.isFetching}
                    onClick={() => setPage((current) => current - 1)}
                    size="sm"
                    variant="outline"
                  >
                    Anterior
                  </Button>
                  <Button
                    disabled={
                      page + 1 >= totalPages || customers.isFetching
                    }
                    onClick={() => setPage((current) => current + 1)}
                    size="sm"
                    variant="outline"
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <CustomerDialog
        customer={editing}
        isSaving={saveCustomer.isPending}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        onSave={(values) => saveCustomer.mutateAsync(values)}
        open={dialogOpen}
      />
      <CustomerDetails
        canEdit={canEdit}
        customer={selected}
        onEdit={() => {
          if (!selected) return;
          setEditing(selected);
          setSelected(null);
          setDetailsOpen(false);
          setDialogOpen(true);
        }}
        onOpenChange={(open) => {
          setDetailsOpen(open);
          if (!open) setSelected(null);
        }}
        open={detailsOpen}
      />
    </div>
  );
}
