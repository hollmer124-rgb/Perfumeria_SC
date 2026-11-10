import { useState } from "react";
import { Link } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  AuthPageLayout,
  AuthConfigurationNotice,
} from "@/features/auth/auth-guards";
import { useAuth } from "@/features/auth/use-auth";
import { FormField } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const recoverySchema = z.object({
  email: z.string().trim().email("Ingresa un correo válido."),
});

type RecoveryValues = z.infer<typeof recoverySchema>;

export function RecoverAccessPage() {
  const { requestPasswordReset, isConfigured } = useAuth();
  const [sent, setSent] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RecoveryValues>({ resolver: zodResolver(recoverySchema) });

  async function onSubmit(values: RecoveryValues) {
    setSent(false);
    setServerError(null);
    try {
      await requestPasswordReset(values.email);
      setSent(true);
    } catch {
      setServerError(
        "No se pudo solicitar la recuperación. Inténtalo de nuevo más tarde.",
      );
    }
  }

  return (
    <AuthPageLayout
      eyebrow="Recuperación segura"
      title="Recupera tu acceso"
      description="Te enviaremos un enlace de un solo uso si el correo corresponde a una cuenta activa."
    >
      <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <FormField label="Correo electrónico" error={errors.email?.message} required>
          {(props) => (
            <Input
              autoComplete="email"
              type="email"
              disabled={!isConfigured || isSubmitting || sent}
              {...props}
              {...register("email")}
            />
          )}
        </FormField>
        {sent ? (
          <p className="text-sm leading-6 text-green-800" role="status">
            Si existe una cuenta asociada, recibirás instrucciones para
            restablecer la contraseña.
          </p>
        ) : null}
        {serverError ? (
          <p className="text-sm text-red-700" role="alert">
            {serverError}
          </p>
        ) : null}
        <Button
          className="w-full"
          disabled={!isConfigured || isSubmitting || sent}
          type="submit"
        >
          {isSubmitting ? "Enviando…" : "Enviar enlace de recuperación"}
        </Button>
      </form>
      <Link
        className="mt-5 inline-block text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        to="/login"
      >
        Volver al inicio de sesión
      </Link>
      <AuthConfigurationNotice />
    </AuthPageLayout>
  );
}
