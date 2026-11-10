import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { fetchOperationalReport, dashboardQueryKeys, previousPeriod } from "@/features/dashboard/data";
import type { OperationalReport } from "@/features/dashboard/types";
import { financialErrorMessage } from "@/features/financial/errors";
import { fetchReportFilterOptions, reportFilterQueryKeys } from "@/features/dashboard/report-filters";
import { bogotaDateInputValue } from "@/features/financial/format";
import { formatCop, formatQuantity } from "@/features/inventory/format";

type PeriodPreset = "day" | "week" | "month" | "custom";
type Bucket = "day" | "week" | "month";

const palette = ["#b89b58", "#34302a", "#9d8b67", "#cfc3a5"];
const categoryLabels: Record<string, string> = {
  original: "Original",
  "1.1": "Perfume 1.1",
  replica: "Réplica",
};
const movementLabels: Record<string, string> = {
  opening: "Apertura",
  sale_in: "Venta en efectivo",
  expense_out: "Gasto en efectivo",
  deposit: "Ingreso en efectivo",
  withdrawal: "Retiro",
  closing_adjustment: "Ajuste de cierre",
};
const dateFormatter = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
  timeZone: "America/Bogota",
});

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function presetRange(preset: Exclude<PeriodPreset, "custom">, today: string) {
  if (preset === "day") return { start: today, end: today };
  if (preset === "month") {
    const firstDay = `${today.slice(0, 7)}-01`;
    const nextMonth = new Date(`${firstDay}T12:00:00Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    return { start: firstDay, end: shiftDate(nextMonth.toISOString().slice(0, 10), -1) };
  }
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const start = shiftDate(today, -((weekday + 6) % 7));
  return { start, end: shiftDate(start, 6) };
}

function csvEscape(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@]/.test(value.trimStart())) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadReportCsv(report: OperationalReport, range: { start: string; end: string }) {
  const rows: unknown[][] = [
    ["Sección", "Detalle", "Categoría", "Cantidad", "Unidad", "Ventas COP", "Costo histórico COP", "Otros COP"],
    ...report.sales_by_type.map((item) => [
      "Ventas por categoría",
      categoryLabels[item.category] ?? item.category,
      item.category,
      item.units,
      "unidades",
      item.sales_cop,
      item.historical_cost_cop,
      "",
    ]),
    ...report.top_products.map((item) => [
      "Producto",
      item.name,
      categoryLabels[item.category] ?? item.category,
      item.units,
      "unidades",
      item.sales_cop,
      item.historical_cost_cop,
      "",
    ]),
    ...report.material_consumption.map((item) => [
      "Consumo de material",
      item.material,
      "",
      item.quantity_used,
      item.unit,
      "",
      item.historical_cost_cop,
      "",
    ]),
    ...report.purchases.map((item) => [
      "Compra",
      item.id,
      item.status,
      item.item_count,
      "ítems",
      "",
      "",
      item.total_cop,
    ]),
    ...report.expenses_by_category.map((item) => [
      "Gasto",
      item.category,
      "",
      "",
      "",
      "",
      "",
      item.amount_cop,
    ]),
    ...report.cash_movements.map((item) => [
      "Movimiento de caja",
      movementLabels[item.movement_type] ?? item.movement_type,
      "",
      item.movement_count,
      "movimientos",
      "",
      "",
      item.amount_cop,
    ]),
    ["Resumen", "Ventas netas", "", "", "", report.summary.sales_cop, "", ""],
    ["Resumen", "Costo histórico de ventas", "", "", "", "", report.summary.sales_cost_cop, ""],
    ["Resumen", "Utilidad bruta", "", "", "", "", report.summary.gross_profit_cop, ""],
    ["Resumen", "Otros ingresos", "", "", "", "", "", report.summary.other_income_cop],
    ["Resumen", "Gastos operativos", "", "", "", "", "", report.summary.operating_expenses_cop],
    ["Resumen", "Resultado neto", "", "", "", "", "", report.summary.net_result_cop],
  ];
  const content = [
    `Período,${csvEscape(range.start)} a ${csvEscape(range.end)}`,
    ...rows.map((row) => row.map(csvEscape).join(",")),
  ].join("\r\n");
  const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `perfumeria-sc-informe-${range.start}-${range.end}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReportsPage() {
  const today = bogotaDateInputValue();
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [startDate, setStartDate] = useState(`${today.slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(today);
  const [appliedRange, setAppliedRange] = useState({ start: `${today.slice(0, 7)}-01`, end: today });
  const [bucket, setBucket] = useState<Bucket>("day");
  const [productId, setProductId] = useState("");
  const [category, setCategory] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const filters = useQuery({
    queryKey: reportFilterQueryKeys.options,
    queryFn: fetchReportFilterOptions,
  });
  const compareRange = useMemo(
    () => previousPeriod(appliedRange.start, appliedRange.end),
    [appliedRange],
  );
  const reportQuery = useQuery({
    queryKey: [
      dashboardQueryKeys.trends,
      appliedRange,
      bucket,
      productId,
      category,
      employeeId,
    ],
    queryFn: () =>
      fetchOperationalReport({
        ...appliedRange,
        bucket,
        productId,
        category,
        employeeId,
        compareStart: compareRange.start,
        compareEnd: compareRange.end,
      }),
  });
  const report = reportQuery.data;

  function choosePreset(value: PeriodPreset) {
    setPreset(value);
    if (value === "custom") return;
    const range = presetRange(value, today);
    setStartDate(range.start);
    setEndDate(range.end);
    setAppliedRange(range);
  }

  function applyCustomRange() {
    setAppliedRange({ start: startDate, end: endDate });
  }

  return (
    <div className="space-y-7">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .financial-report-print, .financial-report-print * { visibility: visible !important; }
          .financial-report-print { position: absolute !important; inset: 0 !important; width: 100% !important; padding: 8mm !important; }
          .financial-report-no-print { display: none !important; }
          .financial-report-print .recharts-responsive-container { break-inside: avoid; }
        }
      `}</style>
      <div className="flex flex-wrap items-end justify-between gap-4 financial-report-no-print">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">Finanzas</p>
          <h1 className="mt-2 font-serif text-3xl font-semibold">Informes del negocio</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Datos reales y agregados en PostgreSQL. El costo histórico guardado en cada venta se distingue del costo promedio actual de inventario.
          </p>
        </div>
        <div className="flex gap-2">
          <Button disabled={!report} onClick={() => report && downloadReportCsv(report, appliedRange)} type="button" variant="outline">
            <Download aria-hidden="true" size={16} /> Exportar CSV
          </Button>
          <Button disabled={!report} onClick={() => window.print()} type="button" variant="outline">
            <Printer aria-hidden="true" size={16} /> Imprimir informe
          </Button>
        </div>
      </div>

      <Card className="financial-report-no-print">
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
          <CardDescription>El informe consulta solo el período, producto, categoría y responsable seleccionados.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {([
              ["day", "Día"],
              ["week", "Semana"],
              ["month", "Mes"],
              ["custom", "Personalizado"],
            ] as const).map(([value, label]) => (
              <Button key={value} onClick={() => choosePreset(value)} variant={preset === value ? "default" : "outline"}>
                {label}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <FormField label="Desde">
              {(props) => <Input {...props} onChange={(event) => { setPreset("custom"); setStartDate(event.target.value); }} type="date" value={startDate} />}
            </FormField>
            <FormField label="Hasta (inclusive)">
              {(props) => <Input {...props} onChange={(event) => { setPreset("custom"); setEndDate(event.target.value); }} type="date" value={endDate} />}
            </FormField>
            <FormField label="Agrupar">
              {(props) => (
                <select {...props} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm" onChange={(event) => setBucket(event.target.value as Bucket)} value={bucket}>
                  <option value="day">Diario</option>
                  <option value="week">Semanal</option>
                  <option value="month">Mensual</option>
                </select>
              )}
            </FormField>
            <FormField label="Categoría">
              {(props) => (
                <select {...props} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm" onChange={(event) => setCategory(event.target.value)} value={category}>
                  <option value="">Todas</option>
                  <option value="original">Original</option>
                  <option value="1.1">1.1</option>
                  <option value="replica">Réplica</option>
                </select>
              )}
            </FormField>
            <FormField label="Producto / perfume">
              {(props) => (
                <select {...props} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm" onChange={(event) => setProductId(event.target.value)} value={productId}>
                  <option value="">Todos</option>
                  {(filters.data?.products ?? []).map((product) => <option key={product.id} value={product.id}>{product.name} · {product.product_type}</option>)}
                  {(filters.data?.recipes ?? []).map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.brand} {recipe.name} · réplica {recipe.size_ml} ml</option>)}
                </select>
              )}
            </FormField>
            <FormField label="Empleado">
              {(props) => (
                <select {...props} className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm" onChange={(event) => setEmployeeId(event.target.value)} value={employeeId}>
                  <option value="">Todos</option>
                  {(filters.data?.employees ?? []).map((employee) => <option key={employee.id} value={employee.id}>{employee.display_name}</option>)}
                </select>
              )}
            </FormField>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!startDate || !endDate || startDate > endDate} onClick={applyCustomRange} type="button">Aplicar filtros</Button>
            {(filters.error) ? <span className="text-xs text-destructive">{financialErrorMessage(filters.error, "No se pudieron cargar las opciones de filtro.")}</span> : null}
          </div>
        </CardContent>
      </Card>

      <div className="financial-report-print space-y-6">
        <header className="hidden border-b border-border pb-4 print:block">
          <p className="font-serif text-2xl font-semibold">Perfumeria SC</p>
          <p className="text-sm text-muted-foreground">Informe financiero y operativo · {appliedRange.start} — {appliedRange.end}</p>
        </header>
        {reportQuery.isLoading ? (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">Consultando informe en Supabase…</CardContent></Card>
        ) : reportQuery.error ? (
          <Card>
            <CardContent className="space-y-3 p-6">
              <p className="font-medium">No pudimos generar el informe.</p>
              <p className="text-sm text-muted-foreground">{financialErrorMessage(reportQuery.error, "Verifica tu conexión y tus permisos de administrador.")}</p>
              <Button onClick={() => void reportQuery.refetch()} variant="outline">Reintentar</Button>
            </CardContent>
          </Card>
        ) : report ? (
          <ReportContent report={report} bucket={bucket} />
        ) : null}
      </div>
    </div>
  );
}

function ReportContent({ report, bucket }: { report: OperationalReport; bucket: Bucket }) {
  const metrics = [
    ["Ventas netas", report.summary.sales_cop, "Ventas confirmadas en el período"],
    ["Costo histórico de ventas", report.summary.sales_cost_cop, "Costo guardado al momento de vender"],
    ["Utilidad bruta", report.summary.gross_profit_cop, "Ventas netas menos costo histórico"],
    ["Gastos operativos", report.summary.operating_expenses_cop, "Egresos registrados en el período"],
    ["Otros ingresos", report.summary.other_income_cop, "Ingresos diferentes a ventas"],
    ["Resultado neto estimado", report.summary.net_result_cop, "Utilidad bruta + otros ingresos − gastos"],
  ] as const;
  const percentChange = report.comparison?.sales_cop
    ? ((report.summary.sales_cop - report.comparison.sales_cop) / report.comparison.sales_cop) * 100
    : null;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map(([label, amount, detail]) => (
          <Card key={label}>
            <CardContent className="p-5">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-2 text-xl font-semibold">{formatCop(amount)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ventas {bucket === "day" ? "diarias" : bucket === "week" ? "semanales" : "mensuales"}</CardTitle>
            <CardDescription>
              {report.summary.sale_count} transacciones
              {report.comparison ? ` · período anterior: ${formatCop(report.comparison.sales_cop)}` : ""}
              {percentChange === null ? "" : ` · cambio ${percentChange >= 0 ? "+" : ""}${percentChange.toLocaleString("es-CO", { maximumFractionDigits: 1 })}%`}
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {report.timeline.length ? (
              <ResponsiveContainer height="100%" width="100%">
                <LineChart data={report.timeline} margin={{ top: 8, right: 12, bottom: 4, left: 8 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" tickFormatter={formatBucket} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} minTickGap={24} />
                  <YAxis tickFormatter={formatCompactCop} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={68} />
                  <Tooltip formatter={(value) => [formatCop(Number(value)), "Ventas"]} labelFormatter={(value) => formatBucket(String(value))} contentStyle={{ borderRadius: 12, borderColor: "hsl(var(--border))" }} />
                  <Line dataKey="sales_cop" dot={false} name="Ventas netas" stroke="hsl(var(--gold))" strokeWidth={2.5} type="monotone" />
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="flex h-full items-center justify-center text-sm text-muted-foreground">Sin ventas para este período.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribución por categoría</CardTitle>
            <CardDescription>Ventas agregadas por Original, 1.1 y Réplica.</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {report.sales_by_category.length ? (
              <ResponsiveContainer height="100%" width="100%">
                <PieChart>
                  <Pie data={report.sales_by_category} dataKey="sales_cop" nameKey="category" outerRadius={88} innerRadius={48} paddingAngle={3}>
                    {report.sales_by_category.map((entry, index) => <Cell fill={palette[index % palette.length]} key={entry.category} />)}
                  </Pie>
                  <Tooltip formatter={(value) => formatCop(Number(value))} labelFormatter={(label) => categoryLabels[String(label)] ?? String(label)} />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="flex h-full items-center justify-center text-sm text-muted-foreground">Sin ventas para distribuir.</p>}
          </CardContent>
          <CardContent className="space-y-2 pt-0">
            {report.sales_by_category.map((item) => (
              <div className="flex justify-between gap-3 text-xs" key={item.category}>
                <span>{categoryLabels[item.category] ?? item.category} · {formatQuantity(item.units)} un.</span>
                <strong>{formatCop(item.sales_cop)}</strong>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {report.comparison ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Comparación de períodos</CardTitle><CardDescription>Comparación de ventas y transacciones frente al período anterior de igual duración.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <ComparisonMetric label="Período actual" value={report.summary.sales_cop} />
            <ComparisonMetric label="Período anterior" value={report.comparison.sales_cop} />
            <div className="rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground">Cambio de ventas</p>
              <p className="mt-2 text-lg font-semibold">{percentChange === null ? "—" : `${percentChange >= 0 ? "+" : ""}${percentChange.toLocaleString("es-CO", { maximumFractionDigits: 1 })}%`}</p>
              <p className="mt-1 text-xs text-muted-foreground">{report.comparison.transactions} transacciones antes · {report.summary.sale_count} actuales</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <ReportTable
          title="Rentabilidad por tipo"
          description="Costos históricos de venta, no costo promedio actual."
          headers={["Categoría", "Unidades", "Ventas", "Costo histórico", "Utilidad bruta"]}
          rows={report.sales_by_type.map((item) => [
            categoryLabels[item.category] ?? item.category,
            formatQuantity(item.units),
            formatCop(item.sales_cop),
            formatCop(item.historical_cost_cop),
            formatCop(item.sales_cop - item.historical_cost_cop),
          ])}
        />
        <ReportTable
          title="Productos más vendidos"
          description="Clasificados por unidades e importe de venta."
          headers={["Producto", "Categoría", "Unidades", "Ventas"]}
          rows={report.top_products.map((item) => [
            item.name,
            categoryLabels[item.category] ?? item.category,
            formatQuantity(item.units),
            formatCop(item.sales_cop),
          ])}
        />
        <ReportTable
          title="Consumo de esencias y materiales"
          description="Consumo real de materiales registrado en cada venta."
          headers={["Material", "Consumo", "Costo histórico"]}
          rows={report.material_consumption.map((item) => [
            item.material,
            `${formatQuantity(item.quantity_used)} ${item.unit}`,
            formatCop(item.historical_cost_cop),
          ])}
        />
        <ReportTable
          title="Compras"
          description="Compras registradas dentro del período seleccionado."
          headers={["Fecha", "Estado", "Ítems", "Total"]}
          rows={report.purchases.map((item) => [
            dateFormatter.format(new Date(item.purchased_at)),
            item.status === "received" ? "Recibida" : item.status === "cancelled" ? "Cancelada" : "Borrador",
            String(item.item_count),
            formatCop(item.total_cop),
          ])}
        />
        <ReportTable
          title="Gastos por categoría"
          description="Egresos operativos, separados de costos de venta."
          headers={["Categoría", "Total"]}
          rows={report.expenses_by_category.map((item) => [item.category, formatCop(item.amount_cop)])}
        />
        <ReportTable
          title="Movimientos de caja"
          description="Movimientos agregados; solo operaciones de efectivo afectan el saldo contado."
          headers={["Movimiento", "Cantidad", "Importe"]}
          rows={report.cash_movements.map((item) => [
            movementLabels[item.movement_type] ?? item.movement_type,
            String(item.movement_count),
            formatCop(item.amount_cop),
          ])}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        El informe no recalcula ventas pasadas con costos promedio actuales. Los importes de compra representan compras registradas; los costos de venta provienen de su fotografía histórica.
      </p>
    </>
  );
}

function ComparisonMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold">{formatCop(value)}</p>
    </div>
  );
}

function ReportTable({
  title,
  description,
  headers,
  rows,
}: {
  title: string;
  description: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {!rows.length ? <p className="text-sm text-muted-foreground">No hay datos para este período.</p> : (
          <table className="w-full min-w-[28rem] text-left text-xs">
            <thead><tr className="border-b border-border text-muted-foreground">{headers.map((header) => <th className="px-2 py-2 font-medium" key={header}>{header}</th>)}</tr></thead>
            <tbody>{rows.map((row, index) => <tr className="border-b border-border last:border-0" key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => <td className="px-2 py-2" key={`${cellIndex}-${cell}`}>{cell}</td>)}</tr>)}</tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function formatBucket(value: string) {
  return dateFormatter.format(new Date(`${value}T12:00:00-05:00`));
}

function formatCompactCop(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M`;
  if (value >= 1_000) return `$${(value / 1_000).toLocaleString("es-CO", { maximumFractionDigits: 0 })} mil`;
  return formatCop(value);
}
