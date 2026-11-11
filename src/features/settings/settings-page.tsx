import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  Building2,
  KeyRound,
  Mail,
  Save,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/features/auth/use-auth";
import {
  fetchAccountProfile,
  fetchBusinessSettings,
  fetchStaffProfiles,
  settingsQueryKeys,
  updateBusinessSettings,
  type BusinessSettings,
} from "@/features/settings/data";
import { supabase } from "@/lib/supabase";
import { notify } from "@/lib/notifications";
import { operationErrorMessage } from "@/lib/operation-error";

const businessSchema = z.object({
  business_name: z
    .string()
    .trim()
    .min(1, "Ingresa el nombre del negocio.")
    .max(160, "El nombre no puede superar 160 caracteres."),
  phone: z.string().trim().max(40, "El teléfono no puede superar 40 caracteres."),
  email: z.union([
    z.literal(""),
    z.string().trim().email("Ingresa un correo válido.").max(254),
  ]),
  address: z.string().trim().max(300, "La dirección no puede superar 300 caracteres."),
});

type BusinessValues = z.infer<typeof businessSchema>;

const profileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "Ingresa el nombre que se mostrará en la aplicación.")
    .max(120, "El nombre no puede superar 120 caracteres."),
  phone: z.string().trim(),
});

type ProfileValues = z.infer<typeof profileSchema>;

const emailSchema = z.object({
  email: z.string().trim().email("Ingresa un correo válido."),
});

type EmailValues = z.infer<typeof emailSchema>;

const passwordSchema = z
  .object({
    password: z.string().min(12, "La contraseña debe tener al menos 12 caracteres."),
    confirmation: z.string(),
  })
  .refine((values) => values.password === values.confirmation, {
    message: "Las contraseñas no coinciden.",
    path: ["confirmation"],
  });

type PasswordValues = z.infer<typeof passwordSchema>;

const dateFormatter = new Intl.DateTimeFormat("es-CO", {
  dateStyle: "medium",
});

function BusinessForm({
  settings,
  canEdit,
}: {
  settings: BusinessSettings;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const values = useMemo<BusinessValues>(
    () => ({
      business_name: settings.business_name,
      phone: settings.phone ?? "",
      email: settings.email ?? "",
      address: settings.address ?? "",
    }),
    [settings],
  );
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BusinessValues>({
    resolver: zodResolver(businessSchema),
    values,
  });
  const save = useMutation({
    mutationFn: async (formValues: BusinessValues) => {
      await updateBusinessSettings({
          business_name: formValues.business_name.trim(),
          phone: formValues.phone.trim() || null,
          email: formValues.email.trim().toLocaleLowerCase("es-CO") || null,
          address: formValues.address.trim() || null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: settingsQueryKeys.business,
      });
      notify.success("Los datos del negocio se guardaron.");
    },
    onError: (error) =>
      notify.error(
        operationErrorMessage(
          error,
          "No se pudieron guardar los datos del negocio.",
          "Business settings update failed",
        ),
      ),
  });

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={handleSubmit((formValues) => save.mutate(formValues))}
    >
      {canEdit ? (
        <>
          <FormField
            className="sm:col-span-2"
            label="Nombre comercial"
            error={errors.business_name?.message}
            required
          >
            {(props) => (
              <Input
                autoComplete="organization"
                {...props}
                {...register("business_name")}
              />
            )}
          </FormField>
          <FormField label="Teléfono" error={errors.phone?.message}>
            {(props) => (
              <Input
                autoComplete="tel"
                inputMode="tel"
                type="tel"
                {...props}
                {...register("phone")}
              />
            )}
          </FormField>
          <FormField label="Correo" error={errors.email?.message}>
            {(props) => (
              <Input
                autoComplete="email"
                type="email"
                {...props}
                {...register("email")}
              />
            )}
          </FormField>
          <FormField className="sm:col-span-2" label="Dirección">
            {(props) => <Textarea {...props} {...register("address")} />}
          </FormField>
          <div className="flex justify-end sm:col-span-2">
            <Button disabled={save.isPending} type="submit">
              <Save aria-hidden="true" size={15} />
              {save.isPending ? "Guardando…" : "Guardar datos"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <dl className="grid gap-4 sm:grid-cols-2 sm:col-span-2">
            <div>
              <dt className="text-xs text-muted-foreground">Nombre comercial</dt>
              <dd className="mt-1 text-sm">{settings.business_name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Teléfono</dt>
              <dd className="mt-1 text-sm">{settings.phone || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Correo</dt>
              <dd className="mt-1 break-all text-sm">{settings.email || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Dirección</dt>
              <dd className="mt-1 text-sm">{settings.address || "—"}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Solo un administrador puede modificar estos datos.
          </p>
        </>
      )}
    </form>
  );
}

export function SettingsPage() {
  const { profile, session, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const business = useQuery({
    queryKey: settingsQueryKeys.business,
    queryFn: fetchBusinessSettings,
    enabled: Boolean(
      session?.user.id && profile?.id === session.user.id,
    ),
  });
  const staff = useQuery({
    queryKey: settingsQueryKeys.staff,
    queryFn: fetchStaffProfiles,
    enabled: profile?.role === "admin",
  });
  const account = useQuery({
    queryKey: settingsQueryKeys.profile(session?.user.id ?? ""),
    queryFn: () => fetchAccountProfile(session!.user.id),
    enabled: Boolean(session?.user.id),
  });

  const saveProfile = useMutation({
    mutationFn: async (values: ProfileValues) => {
      if (!supabase || !session?.user.id) {
        throw new Error("No hay una sesión autenticada.");
      }
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: values.display_name.trim(),
          phone: values.phone.trim() || null,
        })
        .eq("id", session.user.id)
        .select("id")
        .single();
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: settingsQueryKeys.profile(session!.user.id),
        }),
        refreshProfile(),
      ]);
      notify.success("Tu perfil se actualizó.");
    },
    onError: (error) =>
      notify.error(
        operationErrorMessage(
          error,
          "No se pudo actualizar tu perfil.",
          "Profile update failed",
        ),
      ),
  });

  const changeEmail = useMutation({
    mutationFn: async (values: EmailValues) => {
      if (!supabase) throw new Error("Supabase Auth no está configurado.");
      const { error } = await supabase.auth.updateUser({
        email: values.email.trim(),
      });
      if (error) throw error;
    },
    onSuccess: (_data, values) => {
      setEmailNotice(
        `Solicitud enviada para ${values.email.trim()}. Revisa el correo de confirmación para completar el cambio.`,
      );
      notify.success("La solicitud de cambio de correo se envió.");
    },
    onError: (error) =>
      notify.error(
        operationErrorMessage(
          error,
          "No se pudo solicitar el cambio de correo.",
          "Auth email update failed",
        ),
      ),
  });

  const changePassword = useMutation({
    mutationFn: async (values: PasswordValues) => {
      if (!supabase) throw new Error("Supabase Auth no está configurado.");
      const { error } = await supabase.auth.updateUser({
        password: values.password,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      notify.success("La contraseña se actualizó.");
    },
    onError: (error) =>
      notify.error(
        operationErrorMessage(
          error,
          "No se pudo actualizar la contraseña.",
          "Auth password update failed",
        ),
      ),
  });

  const profileValues = useMemo<ProfileValues>(
    () => ({
      display_name: account.data?.display_name ?? profile?.display_name ?? "",
      phone: account.data?.phone ?? "",
    }),
    [account.data, profile?.display_name],
  );
  const profileForm = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    values: profileValues,
  });
  const emailForm = useForm<EmailValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: "" },
  });
  const passwordForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "", confirmation: "" },
  });

  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Administración
        </p>
        <h1 className="font-serif text-3xl font-semibold tracking-tight">
          Configuración
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Administra los datos del negocio y tu acceso. Los cambios de cuenta
          utilizan Supabase Auth; los roles se mantienen protegidos en el perfil.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 aria-hidden="true" className="text-gold" size={17} />
            Datos del negocio
          </CardTitle>
        </CardHeader>
        <CardContent>
          {business.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando configuración…</p>
          ) : business.isError ? (
            <div className="space-y-3">
              <p className="text-sm text-red-700">
                No se pudo cargar la configuración del negocio.
              </p>
              <Button
                onClick={() => void business.refetch()}
                type="button"
                variant="outline"
              >
                Reintentar
              </Button>
            </div>
          ) : business.data ? (
            <BusinessForm
              canEdit={profile?.role === "admin"}
              settings={business.data}
            />
          ) : (
            <div className="space-y-2" role="status">
              <p className="text-sm font-medium">
                La configuración del negocio aún no está inicializada.
              </p>
              <p className="text-sm text-muted-foreground">
                Pide al administrador que aplique las migraciones de la base de
                datos. No se creó ningún registro automáticamente desde el
                navegador.
              </p>
              <Button
                onClick={() => void business.refetch()}
                type="button"
                variant="outline"
              >
                Volver a consultar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck aria-hidden="true" className="text-gold" size={17} />
            Mi cuenta
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-8 xl:grid-cols-2">
          <form
            className="space-y-4"
            onSubmit={profileForm.handleSubmit((values) =>
              saveProfile.mutate(values),
            )}
          >
            <h2 className="font-medium">Perfil</h2>
            <FormField
              label="Nombre visible"
              error={profileForm.formState.errors.display_name?.message}
              required
            >
              {(props) => (
                <Input
                  autoComplete="name"
                  {...props}
                  {...profileForm.register("display_name")}
                />
              )}
            </FormField>
            <FormField label="Teléfono">
              {(props) => (
                <Input
                  autoComplete="tel"
                  inputMode="tel"
                  type="tel"
                  {...props}
                  {...profileForm.register("phone")}
                />
              )}
            </FormField>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted-foreground">Rol</span>
              <span className="font-medium">
                {profile?.role === "admin" ? "Administrador" : "Empleado"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              El rol no se puede cambiar desde el perfil propio.
            </p>
            <Button disabled={saveProfile.isPending} type="submit">
              <Save aria-hidden="true" size={15} />
              Guardar perfil
            </Button>
          </form>

          <div className="space-y-7">
            <form
              className="space-y-4"
              onSubmit={emailForm.handleSubmit((values) =>
                changeEmail.mutate(values),
              )}
            >
              <h2 className="flex items-center gap-2 font-medium">
                <Mail aria-hidden="true" className="text-gold" size={16} />
                Correo de acceso
              </h2>
              <p className="break-all text-sm text-muted-foreground">
                Correo actual: {session?.user.email ?? "No disponible"}
              </p>
              <FormField
                label="Nuevo correo"
                error={emailForm.formState.errors.email?.message}
                required
              >
                {(props) => (
                  <Input
                    autoComplete="email"
                    type="email"
                    {...props}
                    {...emailForm.register("email")}
                  />
                )}
              </FormField>
              {emailNotice ? (
                <p className="text-xs text-muted-foreground" role="status">
                  {emailNotice}
                </p>
              ) : null}
              <Button disabled={changeEmail.isPending} type="submit" variant="outline">
                {changeEmail.isPending ? "Enviando…" : "Solicitar cambio"}
              </Button>
            </form>

            <form
              className="space-y-4 border-t border-border pt-6"
              onSubmit={passwordForm.handleSubmit((values) =>
                changePassword.mutate(values, {
                  onSuccess: () =>
                    passwordForm.reset({ password: "", confirmation: "" }),
                }),
              )}
            >
              <h2 className="flex items-center gap-2 font-medium">
                <KeyRound aria-hidden="true" className="text-gold" size={16} />
                Cambiar contraseña
              </h2>
              <FormField
                label="Nueva contraseña"
                error={passwordForm.formState.errors.password?.message}
                required
              >
                {(props) => (
                  <Input
                    autoComplete="new-password"
                    type="password"
                    {...props}
                    {...passwordForm.register("password")}
                  />
                )}
              </FormField>
              <FormField
                label="Confirmación"
                error={passwordForm.formState.errors.confirmation?.message}
                required
              >
                {(props) => (
                  <Input
                    autoComplete="new-password"
                    type="password"
                    {...props}
                    {...passwordForm.register("confirmation")}
                  />
                )}
              </FormField>
              <Button disabled={changePassword.isPending} type="submit" variant="outline">
                {changePassword.isPending ? "Actualizando…" : "Actualizar contraseña"}
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>

      {profile?.role === "admin" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersRound aria-hidden="true" className="text-gold" size={17} />
              Usuarios con perfil
            </CardTitle>
          </CardHeader>
          <CardContent>
            {staff.isLoading ? (
              <p className="text-sm text-muted-foreground">Cargando perfiles…</p>
            ) : staff.isError ? (
              <div className="space-y-3">
                <p className="text-sm text-red-700">
                  No se pudieron cargar los perfiles.
                </p>
                <Button
                  onClick={() => void staff.refetch()}
                  type="button"
                  variant="outline"
                >
                  Reintentar
                </Button>
              </div>
            ) : (
              <>
                <p className="mb-4 text-sm text-muted-foreground">
                  Se muestran los datos disponibles en los perfiles. El correo
                  de acceso y el estado de Auth se omiten porque no existe una
                  API administrativa segura para consultar esos datos desde el
                  navegador.
                </p>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[32rem] text-left text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Nombre</th>
                        <th className="px-4 py-3 font-medium">Rol</th>
                        <th className="px-4 py-3 font-medium">Teléfono</th>
                        <th className="px-4 py-3 font-medium">Perfil desde</th>
                        <th className="px-4 py-3 font-medium">Acceso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(staff.data ?? []).map((user) => (
                        <tr className="border-t border-border" key={user.id}>
                          <td className="px-4 py-3 font-medium">
                            {user.display_name}
                          </td>
                          <td className="px-4 py-3">
                            {user.role === "admin" ? "Administrador" : "Empleado"}
                          </td>
                          <td className="px-4 py-3">{user.phone || "—"}</td>
                          <td className="px-4 py-3">
                            {dateFormatter.format(new Date(user.created_at))}
                          </td>
                          <td className="px-4 py-3">Perfil configurado</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
