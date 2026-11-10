import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Boxes,
  ChartNoAxesCombined,
  Coins,
  Package,
  ReceiptText,
  ShoppingBag,
  WalletCards,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/use-auth";
import { QuickAccess } from "@/features/dashboard/components/quick-access";
import { dashboardQueryKeys, fetchDashboardMetrics } from "@/features/dashboard/data";
import { financialErrorMessage } from "@/features/financial/errors";
import { formatCop, formatQuantity } from "@/features/inventory/format";

const dateFormatter = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "short",
  timeZone: "America/Bogota",
});

const categoryLabels: Record<string, string> = {
  original: "Original",
  "1.1": "Perfume 1.1",
  replica: "Réplica",
  essence: "Esencia",
  alcohol: "Alcohol",
  pheromone: "Feromonas",
  bottle: "Frascos",
  other: "Otro material",
};

export function DashboardPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
  const metrics = useQuery({
    queryKey: [...dashboardQueryKeys.metrics, profile?.id, profile?.role],
    queryFn: fetchDashboardMetrics,
    enabled: Boolean(profile?.id),
    refetchInterval: 60_000,
  });
  const data = metrics.data;
  const comparisonPercent = data?.previous_month_sales_cop
    ? (data.month_sales_change_cop / data.previous_month_sales_cop) * 100
    : null;

  return (
    <div className="space-y-8 sm:space-y-10">
      <section className="flex flex-col gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">Panel principal</p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-[2.4rem]">Cada detalle, en su lugar.</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Resumen actualizado desde las operaciones reales de Perfumeria SC.
        </p>
      </section>

      {metrics.isLoading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Cargando indicadores reales…</CardContent></Card>
      ) : metrics.error ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
            <div>
              <p className="font-medium">No pudimos cargar el dashboard.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {financialErrorMessage(metrics.error, "Verifica tu conexión y tus permisos.")}
              </p>
            </div>
            <Button onClick={() => void metrics.refetch()} variant="outline">Reintentar</Button>
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <section aria-label="Indicadores del negocio" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard icon={ShoppingBag} label="Ventas del día" value={formatCop(data.day_sales_cop)} detail={`${data.day_transactions} transacciones`} />
            <MetricCard
              icon={ChartNoAxesCombined}
              label="Ventas del mes"
              value={formatCop(data.month_sales_cop)}
              detail={comparisonPercent === null
                ? "Sin ventas del período equivalente anterior"
                : `${comparisonPercent >= 0 ? "+" : ""}${comparisonPercent.toLocaleString("es-CO", { maximumFractionDigits: 1 })}% vs. mismo período anterior`}
              positive={comparisonPercent === null ? undefined : comparisonPercent >= 0}
            />
            {isAdmin ? (
              <>
                <MetricCard icon={Coins} label="Utilidad bruta del mes" value={formatCop(data.month_gross_profit_cop ?? 0)} detail="Ventas menos costo histórico vendido" />
                <MetricCard icon={ReceiptText} label="Gastos del mes" value={formatCop(data.month_expenses_cop ?? 0)} detail="Gastos operativos registrados" />
                <MetricCard icon={Banknote} label="Utilidad neta estimada" value={formatCop(data.month_net_result_cop ?? 0)} detail="Utilidad bruta + otros ingresos − gastos" />
              </>
            ) : null}
            <MetricCard
              icon={WalletCards}
              label="Cajas abiertas"
              value={String(data.open_cash_sessions.length)}
              detail={data.open_cash_sessions.length
                ? data.open_cash_sessions.map((session) => formatCop(session.expected_cop)).join(" · ")
                : "No tienes una sesión de caja abierta"}
            />
          </section>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.8fr)]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ventas diarias · últimos 30 días</CardTitle>
                <CardDescription>
                  {isAdmin
                    ? "Importes de ventas finalizadas. El costo histórico se conserva por separado."
                    : "Ventas visibles según los permisos de tu cuenta."}
                </CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                {data.timeline.length ? (
                  <ResponsiveContainer height="100%" width="100%">
                    <LineChart data={data.timeline} margin={{ top: 8, right: 12, bottom: 4, left: 8 }}>
                      <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        axisLine={false}
                        dataKey="period"
                        tickFormatter={(value: string) => dateFormatter.format(new Date(`${value}T12:00:00-05:00`))}
                        tickLine={false}
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                        minTickGap={24}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                        tickFormatter={(value: number) => value >= 1_000_000 ? `$${(value / 1_000_000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M` : `$${(value / 1_000).toLocaleString("es-CO", { maximumFractionDigits: 0 })} mil`}
                        width={66}
                      />
                      <Tooltip
                        formatter={(value) => [formatCop(Number(value)), "Ventas"]}
                        labelFormatter={(value) => dateFormatter.format(new Date(`${String(value)}T12:00:00-05:00`))}
                        contentStyle={{ borderRadius: 12, borderColor: "hsl(var(--border))" }}
                      />
                      <Line dataKey="sales_cop" dot={false} name="Ventas" stroke="hsl(var(--gold))" strokeWidth={2.5} type="monotone" />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <p className="flex h-full items-center justify-center text-sm text-muted-foreground">Aún no hay ventas en el período.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Más vendidos del mes</CardTitle>
                <CardDescription>Unidades y ventas agregadas de las ventas finalizadas.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!data.top_products.length ? <p className="text-sm text-muted-foreground">Sin productos vendidos este mes.</p> : data.top_products.map((item, index) => (
                  <div className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0" key={`${item.name}-${item.category}`}>
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold-soft text-xs font-semibold text-gold">{index + 1}</span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.name}</p>
                        <p className="text-[11px] text-muted-foreground">{categoryLabels[item.category] ?? item.category} · {formatQuantity(item.units)} un.</p>
                      </div>
                    </div>
                    <p className="shrink-0 text-sm font-medium">{formatCop(item.sales_cop)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <StockCard
              icon={Boxes}
              title="Materiales por agotarse"
              items={data.low_stock_materials.map((item) => ({
                id: item.id,
                name: item.name,
                label: categoryLabels[item.category] ?? item.category,
                stock: `${formatQuantity(item.on_hand)} ${item.unit}`,
                minimum: `${formatQuantity(item.minimum)} ${item.unit}`,
              }))}
              empty="No hay materiales activos por debajo del mínimo configurado."
              href="/inventario"
            />
            <StockCard
              icon={Package}
              title="Productos terminados por agotarse"
              items={data.low_stock_products.map((item) => ({
                id: item.id,
                name: item.name,
                label: categoryLabels[item.category] ?? item.category,
                stock: `${formatQuantity(item.on_hand)} un.`,
                minimum: `${formatQuantity(item.minimum)} un.`,
              }))}
              empty="No hay productos activos por debajo del mínimo configurado."
              href="/productos"
            />
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Transacciones recientes</CardTitle>
                <CardDescription>Actividad obtenida del historial real de ventas.</CardDescription>
              </div>
              <Link className="text-xs font-medium text-gold hover:underline" to="/ventas">Ver ventas</Link>
            </CardHeader>
            <CardContent className="p-0">
              {!data.recent_sales.length ? (
                <p className="p-6 text-sm text-muted-foreground">No hay transacciones recientes.</p>
              ) : (
                <div className="divide-y divide-border">
                  {data.recent_sales.map((sale) => (
                    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3" key={sale.id}>
                      <div>
                        <p className="text-sm font-medium">Venta #{sale.sale_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" }).format(new Date(sale.created_at))}
                          {" · "}{sale.payment_method === "cash" ? "Efectivo" : sale.payment_method === "transfer" ? "Transferencia" : sale.payment_method === "card" ? "Tarjeta" : "Otro"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{formatCop(sale.total_cop)}</p>
                        {isAdmin && sale.cost_cop !== null ? (
                          <p className="text-[11px] text-muted-foreground">Costo histórico: {formatCop(sale.cost_cop)}</p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <QuickAccess />
        </>
      ) : null}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  positive,
}: {
  icon: typeof ShoppingBag;
  label: string;
  value: string;
  detail: string;
  positive?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-3 font-serif text-2xl font-semibold leading-none">{value}</p>
          <p className={`mt-3 flex items-center gap-1 text-[11px] ${positive === undefined ? "text-muted-foreground" : positive ? "text-emerald-700" : "text-destructive"}`}>
            {positive === undefined ? null : positive ? <ArrowUpRight aria-hidden="true" size={13} /> : <ArrowDownRight aria-hidden="true" size={13} />}
            {detail}
          </p>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold-soft text-gold">
          <Icon aria-hidden="true" size={17} strokeWidth={1.7} />
        </span>
      </CardContent>
    </Card>
  );
}

function StockCard({
  icon: Icon,
  title,
  items,
  empty,
  href,
}: {
  icon: typeof Boxes;
  title: string;
  items: Array<{ id: string; name: string; label: string; stock: string; minimum: string }>;
  empty: string;
  href: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon aria-hidden="true" className="text-gold" size={17} />
            {title}
          </CardTitle>
          <CardDescription>Existencias iguales o inferiores al mínimo configurado.</CardDescription>
        </div>
        {items.length ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800"><AlertTriangle aria-hidden="true" size={13} />{items.length}</span> : null}
      </CardHeader>
      <CardContent>
        {!items.length ? <p className="text-sm text-muted-foreground">{empty}</p> : (
          <div className="space-y-3">
            {items.map((item) => (
              <div className="flex items-center justify-between gap-3" key={item.id}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="text-[11px] text-muted-foreground">{item.label} · mínimo {item.minimum}</p>
                </div>
                <p className="shrink-0 text-sm font-semibold text-amber-800">{item.stock}</p>
              </div>
            ))}
            <Link className="inline-block pt-1 text-xs font-medium text-gold hover:underline" to={href}>Revisar inventario</Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
