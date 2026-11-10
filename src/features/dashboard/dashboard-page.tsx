import {
  ArrowUpRight,
  Boxes,
  ChartNoAxesCombined,
  ShoppingBag,
  WalletCards,
} from "lucide-react";
import { Link } from "react-router-dom";
import { OverviewCard } from "@/features/dashboard/components/overview-card";
import { QuickAccess } from "@/features/dashboard/components/quick-access";
import { RecentActivity } from "@/features/dashboard/components/recent-activity";

const overviewItems = [
  { label: "Ventas del día", icon: ShoppingBag },
  { label: "Referencias de producto", icon: Boxes },
  { label: "Estado de inventario", icon: ChartNoAxesCombined },
  { label: "Estado de caja", icon: WalletCards },
];

export function DashboardPage() {
  return (
    <div className="space-y-8 sm:space-y-10">
      <section className="flex flex-col gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">
          Panel principal
        </p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-[2.4rem]">
          Cada detalle, en su lugar.
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Una vista serena para acompañar la gestión diaria de Perfumeria SC.
        </p>
      </section>

      <section
        aria-labelledby="welcome-title"
        className="relative isolate overflow-hidden rounded-[1.4rem] bg-[#211f1c] px-6 py-7 text-white sm:px-9 sm:py-9 lg:px-11 lg:py-10"
      >
        <div
          aria-hidden="true"
          className="absolute -right-20 -top-32 -z-10 size-80 rounded-full border border-white/10"
        />
        <div
          aria-hidden="true"
          className="absolute -right-8 -top-20 -z-10 size-56 rounded-full border border-gold/30"
        />
        <div
          aria-hidden="true"
          className="absolute bottom-[-8rem] right-24 -z-10 size-56 rounded-full bg-gold/10 blur-3xl"
        />
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d3bd8e]">
            <span className="size-1.5 rounded-full bg-[#c4a765]" />
            Una nueva etapa comienza
          </span>
          <h2
            id="welcome-title"
            className="mt-4 font-serif text-2xl font-medium leading-tight sm:text-3xl"
          >
            La esencia de una gran experiencia está en cada detalle.
          </h2>
          <p className="mt-3 max-w-xl text-xs leading-6 text-white/65 sm:text-sm">
            Estamos preparando tu espacio de trabajo. Los indicadores y
            movimientos aparecerán aquí cuando sus módulos estén implementados
            y conectados a datos reales.
          </p>
          <Link
            to="/productos"
            className="mt-6 inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/20 px-3.5 text-xs font-medium text-white transition-colors hover:border-[#d3bd8e]/60 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d3bd8e]"
          >
            Explorar módulos
            <ArrowUpRight aria-hidden="true" size={15} />
          </Link>
        </div>
      </section>

      <section
        aria-label="Indicadores del negocio"
        className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-2 xl:grid-cols-4"
      >
        {overviewItems.map((item) => (
          <OverviewCard key={item.label} {...item} />
        ))}
      </section>

      <QuickAccess />

      <section aria-labelledby="activity-title" className="space-y-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold">
            Seguimiento
          </p>
          <h2
            id="activity-title"
            className="mt-1 font-serif text-xl font-semibold"
          >
            Vista de actividad
          </h2>
        </div>
        <RecentActivity />
      </section>
    </div>
  );
}
