import type { ReactNode } from "react";
import { AlertCircle, LoaderCircle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCop } from "@/features/inventory/format";

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">
          {eyebrow}
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </header>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder = "Buscar…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <Search
        aria-hidden="true"
        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        size={16}
      />
      <Input
        aria-label="Buscar"
        className="pl-9 pr-9"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
      {value ? (
        <button
          aria-label="Limpiar búsqueda"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => onChange("")}
          type="button"
        >
          <X aria-hidden="true" size={14} />
        </button>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = "Cargando información…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
      <LoaderCircle aria-hidden="true" className="animate-spin" size={17} />
      {label}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="flex flex-col items-center gap-3 py-12 text-center"
      role="alert"
    >
      <AlertCircle aria-hidden="true" className="text-red-700" size={22} />
      <p className="max-w-lg text-sm text-muted-foreground">
        No pudimos cargar estos datos. Verifica tu conexión y tus permisos.
      </p>
      <Button onClick={onRetry} variant="outline">
        Reintentar
      </Button>
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function MetricCard({
  label,
  value,
  footnote,
}: {
  label: string;
  value: string | number;
  footnote?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      {footnote ? (
        <CardContent className="pt-0 text-xs text-muted-foreground">
          {footnote}
        </CardContent>
      ) : null}
    </Card>
  );
}

export function CostText({ value }: { value: number }) {
  return <>{formatCop(value)}</>;
}
