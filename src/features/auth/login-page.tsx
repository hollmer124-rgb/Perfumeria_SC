import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  AuthConfigurationNotice,
  AuthPageLayout,
  GuestRoute,
} from "@/features/auth/auth-guards";
import { useAuth } from "@/features/auth/use-auth";
import { FormField } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const loginSchema = z.object({
  email: z.string().trim().email("Ingresa un correo válido."),
  password: z.string().min(1, "Ingresa tu contraseña."),
});

type LoginValues = z.infer<typeof loginSchema>;

function friendlyAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.toLowerCase().includes("invalid login credentials")) {
    return "El correo o la contraseña no son correctos.";
  }
  if (message.toLowerCase().includes("email not confirmed")) {
    return "Confirma tu correo antes de iniciar sesión.";
  }
  if (message.toLowerCase().includes("rate limit")) {
    return "Se alcanzó el límite de intentos. Espera un momento e inténtalo de nuevo.";
  }
  return "No fue posible iniciar sesión. Revisa tu conexión e inténtalo de nuevo.";
}

function LoginForm() {
  const { signIn, isConfigured, session, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const locationState = location.state as
    | { from?: { pathname?: string } }
    | null;
  const destination = locationState?.from?.pathname;
  const safeDestination =
    destination?.startsWith("/") && !destination.startsWith("//")
      ? destination
      : "/dashboard";
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  if (session && profile) return <Navigate to="/dashboard" replace />;

  async function onSubmit(values: LoginValues) {
    setServerError(null);
    try {
      await signIn(values.email, values.password);
      navigate(safeDestination, { replace: true });
    } catch (error) {
      setServerError(friendlyAuthError(error));
    }
  }

  return (
    <AuthPageLayout
      eyebrow="Bienvenido"
      title="Inicia sesión"
      description="Accede con la cuenta que el administrador creó para ti."
    >
      <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <FormField label="Correo electrónico" error={errors.email?.message} required>
          {(props) => (
            <Input
              autoComplete="email"
              type="email"
              placeholder="nombre@ejemplo.com"
              disabled={!isConfigured || isSubmitting}
              {...props}
              {...register("email")}
            />
          )}
        </FormField>
        <FormField label="Contraseña" error={errors.password?.message} required>
          {(props) => (
            <Input
              autoComplete="current-password"
              type="password"
              disabled={!isConfigured || isSubmitting}
              {...props}
              {...register("password")}
            />
          )}
        </FormField>
        {serverError ? (
          <p className="text-sm text-red-700" role="alert">
            {serverError}
          </p>
        ) : null}
        <Button
          className="w-full"
          disabled={!isConfigured || isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Verificando…" : "Ingresar"}
        </Button>
      </form>
      <div className="mt-5 flex justify-between gap-3 text-xs">
        <Link
          className="font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          to="/recuperar-acceso"
        >
          ¿Olvidaste tu contraseña?
        </Link>
        <span className="text-muted-foreground">Sin registro público</span>
      </div>
      <AuthConfigurationNotice />
    </AuthPageLayout>
  );
}

export function LoginPage() {
  return (
    <GuestRoute>
      <LoginForm />
    </GuestRoute>
  );
}
