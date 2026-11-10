import { Sparkles } from "lucide-react";
import type { AdminNavigationItem } from "@/types/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ModulePageProps {
  module: AdminNavigationItem;
}

export function ModulePage({ module }: ModulePageProps) {
  const Icon = module.icon;

  return (
    <div className="mx-auto max-w-4xl space-y-7">
      <section>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">
          Módulo en preparación
        </p>
        <div className="mt-2 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl border border-gold/20 bg-gold-soft text-gold">
            <Icon aria-hidden="true" size={20} strokeWidth={1.7} />
          </span>
          <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
            {module.title}
          </h1>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          {module.description}
        </p>
      </section>

      <Card>
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Sparkles aria-hidden="true" size={18} />
          </div>
          <CardTitle className="pt-2">Espacio listo para diseñar</CardTitle>
          <CardDescription>
            Esta ruta y su estructura visual están disponibles. El módulo aún
            no tiene datos, formularios operativos ni acciones habilitadas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="rounded-xl border border-dashed border-border bg-background px-4 py-4 text-xs leading-5 text-muted-foreground">
            No se cargan ni se guardan datos en esta vista. La implementación
            funcional se realizará por fases y con las validaciones
            correspondientes.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
