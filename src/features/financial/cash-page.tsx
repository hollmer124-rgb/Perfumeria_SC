import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, Banknote, Clock3, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/features/auth/use-auth";
import {
  closeFinancialCash,
  fetchCashOverview,
  fetchFinancialPaymentMethods,
  financialQueryKeys,
  openFinancialCash,
  recordCashWithdrawal,
  recordFinancialIncome,
} from "@/features/financial/data";
import type { CashMovement, CashSale, CashSession } from "@/features/financial/types";
import { salesQueryKeys } from "@/features/sales/data";
import { formatCop } from "@/features/inventory/format";
import { bogotaDateInputValue } from "@/features/financial/format";
import { financialErrorMessage } from "@/features/financial/errors";
import { notify } from "@/lib/notifications";

const dateTimeFormatter = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Bogota",
});

const movementLabels: Record<CashMovement["movement_type"], string> = {
  opening: "Apertura",
  sale_in: "Venta",
  expense_out: "Gasto",
  deposit: "Ingreso de efectivo",
  withdrawal: "Retiro",
  closing_adjustment: "Ajuste de cierre",
};

function getSessionSalesByMethod(
  session: CashSession,
  sales: CashSale[],
): Partial<Record<string, number>> {
  if (Object.keys(session.sales_by_method ?? {}).length) return session.sales_by_method;
  return sales
    .filter((sale) => sale.cash_session_id === session.id && sale.status === "completed")
    .reduce<Partial<Record<string, number>>>((totals, sale) => {
      totals[sale.payment_method] = (totals[sale.payment_method] ?? 0) + sale.total_cop;
      return totals;
    }, {});
}

function invalidateCashQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: financialQueryKeys.sessions });
  void queryClient.invalidateQueries({ queryKey: [...salesQueryKeys.cashSessions] });
  void queryClient.invalidateQueries({ queryKey: ["pos-open-cash-sessions"] });
}

export function CashPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: financialQueryKeys.sessions,
    queryFn: fetchCashOverview,
    enabled: Boolean(profile?.id),
  });
  const paymentMethods = useQuery({
    queryKey: financialQueryKeys.methods,
    queryFn: fetchFinancialPaymentMethods,
    enabled: Boolean(profile?.id),
  });
  const [openingAmount, setOpeningAmount] = useState("");
  const [openingNotes, setOpeningNotes] = useState("");
  const [incomeDescription, setIncomeDescription] = useState("");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeMethod, setIncomeMethod] = useState("cash");
  const [incomeNotes, setIncomeNotes] = useState("");
  const [withdrawalDescription, setWithdrawalDescription] = useState("");
  const [withdrawalAmount, setWithdrawalAmount] = useState("");
  const [withdrawalNotes, setWithdrawalNotes] = useState("");
  const [countedAmount, setCountedAmount] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");

  const openSessions = (overview.data?.sessions ?? []).filter((session) => session.status === "open");
  const activeSession = useMemo(
    () =>
      openSessions.find((session) => session.id === selectedSessionId)
      ?? openSessions.find((session) => session.opened_by === profile?.id)
      ?? (profile?.role === "admin" ? openSessions[0] ?? null : null),
    [openSessions, profile?.id, profile?.role, selectedSessionId],
  );
  const salesByMethod = useMemo(() => {
    const totals = new Map<string, number>();
    for (const sale of overview.data?.sales ?? []) {
      if (sale.cash_session_id !== activeSession?.id || sale.status !== "completed") continue;
      totals.set(sale.payment_method, (totals.get(sale.payment_method) ?? 0) + sale.total_cop);
    }
    return totals;
  }, [activeSession?.id, overview.data?.sales]);
  const enabledMethods = (paymentMethods.data ?? []).filter((method) => method.enabled);
  const selectedIncomeMethod = enabledMethods.some((method) => method.method === incomeMethod)
    ? incomeMethod
    : enabledMethods[0]?.method ?? "";
  const sessionMovements = (overview.data?.movements ?? []).filter(
    (movement) => movement.cash_session_id === activeSession?.id,
  );
  const recentSessions = (overview.data?.sessions ?? []).slice(0, 15);

  const openMutation = useMutation({
    mutationFn: openFinancialCash,
    onSuccess: () => {
      invalidateCashQueries(queryClient);
      setOpeningAmount("");
      setOpeningNotes("");
      notify.success("Caja abierta.");
    },
    onError: (error) => notify.error(financialErrorMessage(error, "No se pudo abrir la caja.")),
  });
  const incomeMutation = useMutation({
    mutationFn: recordFinancialIncome,
    onSuccess: () => {
      invalidateCashQueries(queryClient);
      setIncomeDescription("");
      setIncomeAmount("");
      setIncomeNotes("");
      notify.success("Ingreso registrado.");
    },
    onError: (error) => notify.error(financialErrorMessage(error, "No se pudo registrar el ingreso.")),
  });
  const withdrawalMutation = useMutation({
    mutationFn: recordCashWithdrawal,
    onSuccess: () => {
      invalidateCashQueries(queryClient);
      setWithdrawalDescription("");
      setWithdrawalAmount("");
      setWithdrawalNotes("");
      notify.success("Retiro registrado.");
    },
    onError: (error) => notify.error(financialErrorMessage(error, "No se pudo registrar el retiro.")),
  });
  const closeMutation = useMutation({
    mutationFn: closeFinancialCash,
    onSuccess: (result) => {
      invalidateCashQueries(queryClient);
      setCountedAmount("");
      notify.success(
        `Caja cerrada. Diferencia: ${formatCop(result.difference_cop)}; ventas: ${formatCop(result.sales_total_cop)}.`,
      );
    },
    onError: (error) => notify.error(financialErrorMessage(error, "No se pudo cerrar la caja.")),
  });

  function submitOpen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(openingAmount);
    if (!Number.isSafeInteger(amount) || amount < 0) {
      notify.error("El saldo inicial debe ser un valor entero no negativo en COP.");
      return;
    }
    openMutation.mutate({ opening_cop: amount, notes: openingNotes });
  }

  function submitIncome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeSession || !profile?.id) return;
    const amount = Number(incomeAmount);
    if (!incomeDescription.trim() || !Number.isSafeInteger(amount) || amount <= 0) {
      notify.error("Ingresa un concepto y un valor entero positivo en COP.");
      return;
    }
    incomeMutation.mutate({
      description: incomeDescription,
      amount_cop: amount,
      income_date: bogotaDateInputValue(),
      payment_method: selectedIncomeMethod,
      cash_session_id: activeSession.id,
      notes: incomeNotes,
    });
  }

  function submitWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeSession) return;
    const amount = Number(withdrawalAmount);
    if (!withdrawalDescription.trim() || !Number.isSafeInteger(amount) || amount <= 0) {
      notify.error("Ingresa un concepto y un valor entero positivo en COP.");
      return;
    }
    withdrawalMutation.mutate({
      cash_session_id: activeSession.id,
      amount_cop: amount,
      description: withdrawalDescription,
      notes: withdrawalNotes,
    });
  }

  function submitClose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeSession) return;
    const counted = Number(countedAmount);
    if (!Number.isSafeInteger(counted) || counted < 0) {
      notify.error("El efectivo contado debe ser un valor entero no negativo en COP.");
      return;
    }
    closeMutation.mutate({ cash_session_id: activeSession.id, counted_cop: counted });
  }

  if (overview.isLoading || paymentMethods.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando caja y métodos de pago…</p>;
  }
  if (overview.error || paymentMethods.error) {
    const error = overview.error ?? paymentMethods.error;
    const message = financialErrorMessage(error, "Verifica tu conexión y tus permisos.");
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="font-medium">No pudimos cargar los datos de caja.</p>
          <p className="text-sm text-muted-foreground">{message}</p>
          <Button
            onClick={() => {
              void overview.refetch();
              void paymentMethods.refetch();
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
        <h1 className="mt-2 font-serif text-3xl font-semibold">Caja</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Aperturas, ingresos, retiros y cierres con trazabilidad por usuario. El saldo esperado representa efectivo, no transferencias ni utilidad.
        </p>
      </div>

      {!activeSession ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet aria-hidden="true" className="text-gold" size={18} />
              Apertura de caja
            </CardTitle>
            <CardDescription>
              Cada usuario puede mantener una sola sesión abierta; el saldo inicial se considera efectivo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitOpen}>
              <FormField label="Saldo inicial (COP)" required>
                {(props) => (
                  <Input
                    {...props}
                    inputMode="numeric"
                    min="0"
                    onChange={(event) => setOpeningAmount(event.target.value)}
                    required
                    type="number"
                    value={openingAmount}
                  />
                )}
              </FormField>
              <FormField label="Observaciones">
                {(props) => (
                  <Textarea
                    {...props}
                    onChange={(event) => setOpeningNotes(event.target.value)}
                    value={openingNotes}
                  />
                )}
              </FormField>
              <Button className="sm:col-span-2 sm:justify-self-start" disabled={openMutation.isPending} type="submit">
                <Wallet aria-hidden="true" size={16} />
                {openMutation.isPending ? "Abriendo…" : "Abrir caja"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard icon={Wallet} label="Efectivo esperado" value={formatCop(activeSession.expected_cop)} />
            <SummaryCard icon={Banknote} label="Saldo de apertura" value={formatCop(activeSession.opening_cop)} />
            <SummaryCard icon={ArrowDownToLine} label="Ventas en efectivo" value={formatCop(salesByMethod.get("cash") ?? 0)} />
            <SummaryCard icon={Clock3} label="Abierta desde" value={dateTimeFormatter.format(new Date(activeSession.opened_at))} />
          </div>
          {profile?.role === "admin" && openSessions.length > 1 ? (
            <FormField label="Caja abierta que vas a gestionar">
              {(props) => (
                <select
                  {...props}
                  className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm sm:max-w-sm"
                  onChange={(event) => setSelectedSessionId(event.target.value)}
                  value={activeSession.id}
                >
                  {openSessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.id.slice(0, 8)} · {session.opened_by === profile.id ? "Tu sesión" : `Usuario ${session.opened_by.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ventas por método de pago</CardTitle>
              <CardDescription>
                Totales de ventas ligadas a esta sesión. Las devoluciones/anulaciones se mantienen en el historial.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {enabledMethods.map((method) => (
                <div className="rounded-xl border border-border p-4" key={method.method}>
                  <p className="text-xs text-muted-foreground">{method.label}</p>
                  <p className="mt-2 text-lg font-semibold">{formatCop(salesByMethod.get(method.method) ?? 0)}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="grid gap-5 xl:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Otro ingreso</CardTitle>
                <CardDescription>Separado de las ventas. Un ingreso en efectivo aumenta el saldo esperado.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={submitIncome}>
                  <FormField label="Concepto" required>
                    {(props) => <Input {...props} maxLength={240} onChange={(event) => setIncomeDescription(event.target.value)} required value={incomeDescription} />}
                  </FormField>
                  <FormField label="Importe (COP)" required>
                    {(props) => <Input {...props} inputMode="numeric" min="1" onChange={(event) => setIncomeAmount(event.target.value)} required type="number" value={incomeAmount} />}
                  </FormField>
                  <FormField label="Método de pago" required>
                    {(props) => (
                      <select {...props} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm" onChange={(event) => setIncomeMethod(event.target.value)} value={selectedIncomeMethod}>
                        {enabledMethods.map((method) => <option key={method.method} value={method.method}>{method.label}</option>)}
                      </select>
                    )}
                  </FormField>
                  <FormField label="Observaciones">
                    {(props) => <Textarea {...props} onChange={(event) => setIncomeNotes(event.target.value)} value={incomeNotes} />}
                  </FormField>
                  <Button className="w-full" disabled={incomeMutation.isPending || !enabledMethods.length} type="submit">
                    {incomeMutation.isPending ? "Registrando…" : "Registrar ingreso"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Retiro de efectivo</CardTitle>
                <CardDescription>Solo permite retirar efectivo disponible. Los gastos operativos se registran en Gastos.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={submitWithdrawal}>
                  <FormField label="Concepto" required>
                    {(props) => <Input {...props} maxLength={240} onChange={(event) => setWithdrawalDescription(event.target.value)} required value={withdrawalDescription} />}
                  </FormField>
                  <FormField label="Importe (COP)" required>
                    {(props) => <Input {...props} inputMode="numeric" max={activeSession.expected_cop} min="1" onChange={(event) => setWithdrawalAmount(event.target.value)} required type="number" value={withdrawalAmount} />}
                  </FormField>
                  <FormField label="Observaciones">
                    {(props) => <Textarea {...props} onChange={(event) => setWithdrawalNotes(event.target.value)} value={withdrawalNotes} />}
                  </FormField>
                  <Button className="w-full" disabled={withdrawalMutation.isPending} type="submit" variant="outline">
                    <ArrowUpFromLine aria-hidden="true" size={16} />
                    {withdrawalMutation.isPending ? "Registrando…" : "Registrar retiro"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cierre de caja</CardTitle>
                <CardDescription>
                  Cuenta únicamente el efectivo físico. El sistema compara el valor contado con los movimientos de caja.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={submitClose}>
                  <FormField label="Efectivo contado (COP)" required>
                    {(props) => <Input {...props} inputMode="numeric" min="0" onChange={(event) => setCountedAmount(event.target.value)} required type="number" value={countedAmount} />}
                  </FormField>
                  <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                    Esperado: <strong className="text-foreground">{formatCop(activeSession.expected_cop)}</strong>
                  </p>
                  {Number.isSafeInteger(Number(countedAmount)) && countedAmount !== "" ? (
                    <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                      Diferencia estimada:{" "}
                      <strong className="text-foreground">
                        {formatCop(Number(countedAmount) - activeSession.expected_cop)}
                      </strong>
                    </p>
                  ) : null}
                  <Button className="w-full" disabled={closeMutation.isPending} type="submit" variant="outline">
                    {closeMutation.isPending ? "Cerrando…" : "Cerrar caja"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Movimientos de efectivo</CardTitle>
              <CardDescription>Entradas y salidas que afectan el efectivo esperado de esta sesión.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {!sessionMovements.length ? (
                <p className="p-6 text-sm text-muted-foreground">Aún no hay movimientos de efectivo.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Movimiento</TableHead>
                      <TableHead>Concepto / responsable</TableHead>
                      <TableHead className="text-right">Importe</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessionMovements.map((movement) => (
                      <TableRow key={movement.id}>
                        <TableCell className="whitespace-nowrap">{dateTimeFormatter.format(new Date(movement.created_at))}</TableCell>
                        <TableCell>{movementLabels[movement.movement_type]}</TableCell>
                        <TableCell>
                          <span className="block">{movement.description || "—"}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {movement.created_by === profile?.id ? "Tú" : movement.created_by?.slice(0, 8) ?? "Sistema"}
                          </span>
                        </TableCell>
                        <TableCell className={`text-right font-medium ${movement.signed_amount_cop < 0 ? "text-destructive" : ""}`}>
                          {movement.signed_amount_cop < 0 ? "−" : "+"}{formatCop(movement.amount_cop)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Otros ingresos de esta caja</CardTitle>
              <CardDescription>Incluye todos los métodos de pago; solo los ingresos en efectivo modifican el saldo esperado.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {!(overview.data?.incomes ?? []).some((income) => income.cash_session_id === activeSession.id) ? (
                <p className="p-6 text-sm text-muted-foreground">No hay otros ingresos registrados en esta sesión.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Concepto</TableHead>
                      <TableHead>Método</TableHead>
                      <TableHead>Responsable</TableHead>
                      <TableHead className="text-right">Importe</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(overview.data?.incomes ?? [])
                      .filter((income) => income.cash_session_id === activeSession.id)
                      .map((income) => (
                        <TableRow key={income.id}>
                          <TableCell className="whitespace-nowrap">{dateTimeFormatter.format(new Date(income.created_at))}</TableCell>
                          <TableCell>
                            <span className="block">{income.description}</span>
                            {income.notes ? <span className="text-xs text-muted-foreground">{income.notes}</span> : null}
                          </TableCell>
                          <TableCell>{paymentMethods.data?.find((method) => method.method === income.payment_method)?.label ?? income.payment_method}</TableCell>
                          <TableCell>{income.created_by === profile?.id ? "Tú" : income.created_by.slice(0, 8)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCop(income.amount_cop)}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sesiones recientes</CardTitle>
          <CardDescription>El historial conserva saldo esperado, efectivo contado y diferencia de cada cierre.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!recentSessions.length ? (
            <p className="p-6 text-sm text-muted-foreground">No hay sesiones registradas.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Apertura</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Responsable</TableHead>
                  <TableHead>Ventas por método</TableHead>
                  <TableHead className="text-right">Esperado</TableHead>
                  <TableHead className="text-right">Contado</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentSessions.map((session: CashSession) => {
                  const sessionSales = getSessionSalesByMethod(session, overview.data?.sales ?? []);
                  const entries = Object.entries(sessionSales).filter(([, amount]) => Number(amount) > 0);
                  return (
                    <TableRow key={session.id}>
                      <TableCell className="whitespace-nowrap">{dateTimeFormatter.format(new Date(session.opened_at))}</TableCell>
                      <TableCell>{session.status === "open" ? "Abierta" : "Cerrada"}</TableCell>
                      <TableCell>{session.opened_by === profile?.id ? "Tú" : session.opened_by.slice(0, 8)}</TableCell>
                      <TableCell>
                        {entries.length ? (
                          <div className="space-y-1">
                            {entries.map(([method, total]) => (
                              <span className="block text-xs" key={method}>
                                {paymentMethods.data?.find((option) => option.method === method)?.label ?? method}: {formatCop(Number(total))}
                              </span>
                            ))}
                          </div>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right">{formatCop(session.expected_cop)}</TableCell>
                      <TableCell className="text-right">{session.counted_cop === null ? "—" : formatCop(session.counted_cop)}</TableCell>
                      <TableCell className="text-right">{session.difference_cop === null ? "—" : formatCop(session.difference_cop)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-2 text-lg font-semibold">{value}</p>
        </div>
        <Icon aria-hidden="true" className="text-gold" size={18} />
      </CardContent>
    </Card>
  );
}
