import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  fetchExpenseData,
  fetchFinancialPaymentMethods,
  fetchOpenCashSessions,
  financialQueryKeys,
  recordFinancialExpense,
  saveExpenseCategory,
} from "@/features/financial/data";
import { useAuth } from "@/features/auth/use-auth";
import { formatCop } from "@/features/inventory/format";
import { bogotaDateInputValue } from "@/features/financial/format";
import { financialErrorMessage } from "@/features/financial/errors";
import { notify } from "@/lib/notifications";

const dateFormatter = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeZone: "America/Bogota",
});

export function ExpensesPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(bogotaDateInputValue());
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [cashSessionId, setCashSessionId] = useState("");
  const [notes, setNotes] = useState("");
  const [newCategory, setNewCategory] = useState("");

  const expenseData = useQuery({
    queryKey: financialQueryKeys.expenses,
    queryFn: fetchExpenseData,
  });
  const methods = useQuery({
    queryKey: financialQueryKeys.methods,
    queryFn: fetchFinancialPaymentMethods,
  });
  const cashSessions = useQuery({
    queryKey: [...financialQueryKeys.sessions, profile?.id, profile?.role, "open"],
    queryFn: () => fetchOpenCashSessions(profile?.id ?? "", profile?.role === "admin"),
    enabled: Boolean(profile?.id),
  });
  const categories = expenseData.data?.categories ?? [];
  const activeCategories = categories.filter((category) => category.active);
  const enabledMethods = (methods.data ?? []).filter((method) => method.enabled);
  const selectedPaymentMethod = enabledMethods.some((method) => method.method === paymentMethod)
    ? paymentMethod
    : enabledMethods[0]?.method ?? "";
  const openSessions = cashSessions.data ?? [];

  const saveExpense = useMutation({
    mutationFn: recordFinancialExpense,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: financialQueryKeys.expenses }),
        queryClient.invalidateQueries({ queryKey: financialQueryKeys.sessions }),
        queryClient.invalidateQueries({ queryKey: financialQueryKeys.report }),
      ]);
      setDescription("");
      setAmount("");
      setNotes("");
      notify.success("Gasto registrado.");
    },
    onError: (error) => notify.error(financialErrorMessage(error, "No se pudo registrar el gasto.")),
  });
  const saveCategory = useMutation({
    mutationFn: saveExpenseCategory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: financialQueryKeys.expenses });
      setNewCategory("");
      notify.success("Categoría guardada.");
    },
    onError: (error) => notify.error(financialErrorMessage(error, "No se pudo guardar la categoría.")),
  });

  function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCop = Number(amount);
    if (!categoryId || !description.trim() || !Number.isSafeInteger(amountCop) || amountCop <= 0) {
      notify.error("Selecciona categoría y registra concepto e importe entero positivo en COP.");
      return;
    }
    if (selectedPaymentMethod === "cash" && !cashSessionId) {
      notify.error("Selecciona una caja abierta para registrar un gasto en efectivo.");
      return;
    }
    saveExpense.mutate({
      category_id: categoryId,
      description,
      amount_cop: amountCop,
      expense_date: expenseDate,
      payment_method: selectedPaymentMethod,
      cash_session_id: selectedPaymentMethod === "cash" ? cashSessionId : null,
      notes,
    });
  }

  function submitCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile?.id || !newCategory.trim()) {
      notify.error("Ingresa el nombre de la categoría.");
      return;
    }
    saveCategory.mutate({
      name: newCategory,
      active: true,
      created_by: profile.id,
    });
  }

  if (expenseData.isLoading || methods.isLoading || cashSessions.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando gastos y configuración…</p>;
  }
  const queryError = expenseData.error ?? methods.error ?? cashSessions.error;
  if (queryError) {
    const message = financialErrorMessage(queryError, "Verifica tu conexión y tus permisos.");
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="font-medium">No pudimos cargar los gastos.</p>
          <p className="text-sm text-muted-foreground">{message}</p>
          <Button
            onClick={() => {
              void expenseData.refetch();
              void methods.refetch();
              void cashSessions.refetch();
            }}
            variant="outline"
          >
            Reintentar
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-7">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">Finanzas</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold">Gastos operativos</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Registra egresos con categoría, fecha, método de pago y responsable. Los gastos en efectivo se descuentan transaccionalmente del saldo de caja.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registrar gasto</CardTitle>
            <CardDescription>El costo se conserva como egreso operativo; no altera el costo histórico de las ventas.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitExpense}>
              <FormField label="Categoría" required>
                {(props) => (
                  <select {...props} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm" onChange={(event) => setCategoryId(event.target.value)} required value={categoryId}>
                    <option value="">Selecciona categoría</option>
                    {activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                )}
              </FormField>
              <FormField label="Fecha" required>
                {(props) => <Input {...props} onChange={(event) => setExpenseDate(event.target.value)} required type="date" value={expenseDate} />}
              </FormField>
              <FormField className="sm:col-span-2" label="Concepto" required>
                {(props) => <Input {...props} maxLength={240} onChange={(event) => setDescription(event.target.value)} required value={description} />}
              </FormField>
              <FormField label="Importe (COP)" required>
                {(props) => <Input {...props} inputMode="numeric" min="1" onChange={(event) => setAmount(event.target.value)} required type="number" value={amount} />}
              </FormField>
              <FormField label="Método de pago" required>
                {(props) => (
                  <select {...props} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm" onChange={(event) => { setPaymentMethod(event.target.value); setCashSessionId(""); }} value={selectedPaymentMethod}>
                    {enabledMethods.map((method) => <option key={method.method} value={method.method}>{method.label}</option>)}
                  </select>
                )}
              </FormField>
              {selectedPaymentMethod === "cash" ? (
                <FormField className="sm:col-span-2" label="Caja abierta" required>
                  {(props) => (
                    <select {...props} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm" onChange={(event) => setCashSessionId(event.target.value)} required value={cashSessionId}>
                      <option value="">Selecciona caja</option>
                      {openSessions.map((session) => <option key={session.id} value={session.id}>{session.id.slice(0, 8)}</option>)}
                    </select>
                  )}
                </FormField>
              ) : null}
              <FormField className="sm:col-span-2" label="Observaciones">
                {(props) => <Textarea {...props} maxLength={1000} onChange={(event) => setNotes(event.target.value)} value={notes} />}
              </FormField>
              <Button className="sm:col-span-2 sm:justify-self-start" disabled={saveExpense.isPending || !enabledMethods.length || (selectedPaymentMethod === "cash" && !openSessions.length)} type="submit">
                {saveExpense.isPending ? "Registrando…" : "Registrar gasto"}
              </Button>
              {selectedPaymentMethod === "cash" && !openSessions.length ? (
                <p className="sm:col-span-2 text-xs text-muted-foreground">Abre una caja para poder registrar gastos en efectivo.</p>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Tag aria-hidden="true" className="text-gold" size={17} />
              Categorías
            </CardTitle>
            <CardDescription>Arriendo, servicios, transporte, empaques y otros están disponibles inicialmente. Desactiva categorías históricas en lugar de eliminarlas.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="flex gap-2" onSubmit={submitCategory}>
              <Input aria-label="Nombre de la nueva categoría" maxLength={80} onChange={(event) => setNewCategory(event.target.value)} placeholder="Nueva categoría" value={newCategory} />
              <Button aria-label="Agregar categoría" disabled={saveCategory.isPending || !newCategory.trim()} size="icon" type="submit">
                <Plus aria-hidden="true" size={16} />
              </Button>
            </form>
            <ul className="space-y-2">
              {categories.map((category) => (
                <li className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm" key={category.id}>
                  <span>{category.name}</span>
                  <Button
                    disabled={saveCategory.isPending}
                    onClick={() => saveCategory.mutate({
                      id: category.id,
                      name: category.name,
                      active: !category.active,
                      created_by: profile?.id ?? "",
                    })}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {category.active ? "Activa" : "Inactiva"}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historial de gastos</CardTitle>
          <CardDescription>Importes en COP; las categorías enlazadas no se eliminan para conservar la trazabilidad.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!expenseData.data?.expenses.length ? (
            <p className="p-6 text-sm text-muted-foreground">No hay gastos registrados.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Categoría / concepto</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Responsable</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenseData.data.expenses.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell className="whitespace-nowrap">{dateFormatter.format(new Date(`${expense.expense_date}T12:00:00-05:00`))}</TableCell>
                    <TableCell>
                      <span className="block font-medium">{expense.expense_categories?.name ?? "Sin categoría"}</span>
                      <span className="text-xs text-muted-foreground">{expense.description}{expense.notes ? ` · ${expense.notes}` : ""}</span>
                    </TableCell>
                    <TableCell>{methods.data?.find((method) => method.method === expense.payment_method)?.label ?? expense.payment_method}</TableCell>
                    <TableCell>{expense.created_by === profile?.id ? "Tú" : expense.created_by.slice(0, 8)}</TableCell>
                    <TableCell className="text-right font-medium">{formatCop(expense.amount_cop)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
