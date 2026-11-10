import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface OverviewCardProps {
  label: string;
  icon: LucideIcon;
}

export function OverviewCard({ label, icon: Icon }: OverviewCardProps) {
  return (
    <Card className="min-w-0">
      <CardContent className="flex items-start justify-between gap-3 pt-5 sm:pt-6">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-muted-foreground">
            {label}
          </p>
          <p
            aria-label={`${label}: sin datos`}
            className="mt-3 font-serif text-3xl leading-none text-foreground"
          >
            —
          </p>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Se mostrará al conectar datos
          </p>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold-soft text-gold">
          <Icon aria-hidden="true" size={17} strokeWidth={1.7} />
        </span>
      </CardContent>
    </Card>
  );
}
