import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Gem, LoaderCircle, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { appConfig } from "@/lib/app-config";
import { useAuth } from "@/features/auth/use-auth";
import type { AppRole } from "@/features/auth/permissions";
import { notify } from "@/lib/notifications";

export function AuthLoading() {
  return (
    <main className="grid min-h-screen place-items-center px-5">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <LoaderCircle aria-hidden="true" className="animate-spin" size={18} />
        Verificando acceso seguro…
      </div>
    </main>
  );
}

function SessionProblem() {
  const { error, signOut } = useAuth();

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
          Cuenta sin acceso
        </p>
        <h1 className="mt-3 font-serif text-2xl font-semibold">
          No pudimos verificar tu perfil
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {error ??
            "Un administrador debe crear un perfil activo vinculado a esta cuenta."}
        </p>
        <Button
          className="mt-6"
          onClick={() => {
            void signOut().catch(() =>
              notify.error("No se pudo cerrar la sesión. Inténtalo de nuevo."),
            );
          }}
          variant="outline"
        >
          <LogOut aria-hidden="true" size={16} />
          Cerrar sesión
        </Button>
      </section>
    </main>
  );
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, profile, status, error } = useAuth();
  const location = useLocation();

  if (status === "initializing") return <AuthLoading />;
  if (status === "not_configured" || status === "error") {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location, authError: error }}
      />
    );
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (!profile) return <SessionProblem />;

  return children;
}

export function RequireRole({
  allowedRoles,
  children,
}: {
  allowedRoles: AppRole[];
  children: ReactNode;
}) {
  const { profile } = useAuth();
  if (!profile) return <SessionProblem />;
  if (!allowedRoles.includes(profile.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

export function GuestRoute({ children }: { children: ReactNode }) {
  const { session, profile, status } = useAuth();

  if (status === "initializing") return <AuthLoading />;
  if (session && profile) return <Navigate to="/dashboard" replace />;
  if (session && !profile) return <SessionProblem />;

  return children;
}

export function AuthBrand() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-11 items-center justify-center rounded-xl border border-gold/25 bg-gold-soft text-gold">
        <Gem aria-hidden="true" size={21} strokeWidth={1.6} />
      </span>
      <span>
        <span className="block font-serif text-lg font-semibold tracking-wide">
          {appConfig.name}
        </span>
        <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          Administración
        </span>
      </span>
    </div>
  );
}

export function AuthPageLayout({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10 sm:px-6">
      <div aria-hidden="true" className="fixed inset-x-0 top-0 h-1 bg-gold" />
      <section className="w-full max-w-md">
        <AuthBrand />
        <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-[0_24px_70px_-44px_rgba(33,31,27,0.35)] sm:p-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">
            {eyebrow}
          </p>
          <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">
            {title}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
          {children}
        </div>
        <p className="mt-5 text-center text-xs text-muted-foreground">
          Acceso privado para el equipo de Perfumeria SC
        </p>
      </section>
    </main>
  );
}

export function AuthConfigurationNotice() {
  const { status, error, isConfigured } = useAuth();
  if (isConfigured && status !== "error") return null;

  return (
    <p
      className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-950"
      role="alert"
    >
      {isConfigured
        ? error
        : "Configura VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY para habilitar el acceso seguro."}
    </p>
  );
}
