import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { quickAccessModules } from "@/features/navigation/navigation-items";
import { Card } from "@/components/ui/card";

export function QuickAccess() {
  return (
    <section aria-labelledby="quick-access-title" className="space-y-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gold">
          Navegación
        </p>
        <h2
          id="quick-access-title"
          className="mt-1 font-serif text-xl font-semibold"
        >
          Accesos rápidos
        </h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {quickAccessModules.map(({ path, title, description, icon: Icon }) => (
          <Link
            key={path}
            to={path}
            className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <Card className="h-full p-4 transition-all group-hover:-translate-y-0.5 group-hover:border-gold/40 group-hover:shadow-md sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <span className="flex size-9 items-center justify-center rounded-xl bg-gold-soft text-gold">
                  <Icon aria-hidden="true" size={17} strokeWidth={1.7} />
                </span>
                <ArrowUpRight
                  aria-hidden="true"
                  size={16}
                  className="text-muted-foreground transition-colors group-hover:text-gold"
                />
              </div>
              <h3 className="mt-4 text-sm font-semibold">{title}</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {description}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
