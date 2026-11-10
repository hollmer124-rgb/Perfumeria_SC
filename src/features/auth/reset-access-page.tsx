import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AuthPageLayout } from "@/features/auth/auth-guards";
import { useAuth } from "@/features/auth/use-auth";
import { FormField } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const resetSchema = z
  .object({
    password: z.string().min(12, "La contraseña debe tener al menos 12 caracteres."),
    confirmation: z.string(),
  })
  .refine((values) => values.password === values.confirmation, {
    message: "Las contraseñas no coinciden.",
    path: ["confirmation"],
  });

type ResetValues = z.infer<typeof resetSchema>;

export function ResetAccessPage() {
  const { session, status, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetValues>({ resolver: zodResolver(resetSchema) });

  if (status === "initializing") {
    return (
      <main className="grid min-h-screen place-items-center px-5 text-sm text-muted-foreground">
        Verificando el enlace de recuperación…
      </main>
    );
  }
  if (!session) {
    return (
      <AuthPageLayout
        eyebrow="Enlace no válido"
        title="Solicita un nuevo enlace"
        description="El enlace expiró, ya se utilizó o no es válido. Solicita otro para proteger tu cuenta."
      >
        <Link
          className="mt-6 inline-block text-sm font-medium text-gold underline-offset-4 hover:underline"
          to="/recuperar-acceso"
        >
          Solicitar recuperación
        </Link>
      </AuthPageLayout>
    );
  }

  async function onSubmit(values: ResetValues) {
    setServerError(null);
    try {
      await updatePassword(values.password);
      navigate("/dashboard", { replace: true });
    } catch {
      setServerError(
        "No se pudo actualizar la contraseña. Solicita un enlace nuevo e inténtalo otra vez.",
      );
    }
  }

  if (status === "error") return <Navigate to="/login" replace />;

  return (
    <AuthPageLayout
      eyebrow="Nueva contraseña"
      title="Restablece tu acceso"
      description="Elige una contraseña de al menos 12 caracteres que no uses en otros servicios."
    >
      <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <FormField label="Nueva contraseña" error={errors.password?.message} required>
          {(props) => (
            <Input
              autoComplete="new-password"
              type="password"
              {...props}
              {...register("password")}
            />
          )}
        </FormField>
        <FormField
          label="Confirma la contraseña"
          error={errors.confirmation?.message}
          required
        >
          {(props) => (
            <Input
              autoComplete="new-password"
              type="password"
              {...props}
              {...register("confirmation")}
            />
          )}
        </FormField>
        {serverError ? (
          <p className="text-sm text-red-700" role="alert">
            {serverError}
          </p>
        ) : null}
        <Button className="w-full" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Guardando…" : "Guardar contraseña"}
        </Button>
      </form>
    </AuthPageLayout>
  );
}
