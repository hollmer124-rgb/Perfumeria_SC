import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  initializeSupabase,
  isSupabaseConfigured,
  supabase,
} from "@/lib/supabase";
import { AuthContext, type AuthStatus, type UserProfile } from "@/features/auth/auth-context";

function isUserProfile(value: unknown, userId: string): value is UserProfile {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Record<string, unknown>;

  return (
    profile.id === userId &&
    (profile.role === "admin" || profile.role === "employee") &&
    typeof profile.display_name === "string"
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileVersion, setProfileVersion] = useState(0);
  const [status, setStatus] = useState<AuthStatus>(
    isSupabaseConfigured() ? "initializing" : "not_configured",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    if (!isSupabaseConfigured()) return;

    void (async () => {
      try {
        const client = await initializeSupabase();
        if (!active || !client) return;
        const {
          data: { subscription },
        } = client.auth.onAuthStateChange((_event, nextSession) => {
          setSession(nextSession);
          setError(null);
          if (nextSession) {
            setStatus("initializing");
            if (
              _event === "SIGNED_IN" ||
              _event === "TOKEN_REFRESHED" ||
              _event === "USER_UPDATED"
            ) {
              setProfileVersion((version) => version + 1);
            }
          } else {
            setProfile(null);
            setStatus("ready");
          }
        });
        unsubscribe = () => subscription.unsubscribe();

        const { data, error: sessionError } = await client.auth.getSession();
        if (!active) return;
        if (sessionError) {
          setError("No se pudo validar la sesión. Intenta de nuevo.");
          setStatus("error");
          return;
        }
        setSession(data.session);
        if (!data.session) setStatus("ready");
      } catch {
        if (!active) return;
        setError("No se pudo iniciar Supabase Auth. Verifica la configuración.");
        setStatus("error");
      }
    })();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const userId = session?.user.id;
    if (!userId) return;

    let active = true;

    void (async () => {
      try {
        const { data, error: profileError } = await supabase
          .from("profiles")
          .select("id, role, display_name")
          .eq("id", userId)
          .maybeSingle();
        if (!active) return;
        if (profileError) {
          setProfile(null);
          setError(
            "No se pudo verificar tu perfil. Comprueba la conexión o contacta al administrador.",
          );
          setStatus("error");
          return;
        }

        if (!isUserProfile(data, userId)) {
          setProfile(null);
          setError(
            "La cuenta no tiene un perfil válido. Solicita al administrador que la configure.",
          );
          setStatus("error");
          return;
        }

        setProfile(data);
        setStatus("ready");
      } catch {
        if (!active) return;
        setProfile(null);
        setError(
          "No se pudo verificar tu perfil. Comprueba la conexión o contacta al administrador.",
        );
        setStatus("error");
      }
    })();

    return () => {
      active = false;
    };
  }, [profileVersion, session?.user.id]);

  const value = useMemo(
    () => ({
      session,
      profile,
      status,
      error,
      isConfigured: isSupabaseConfigured(),
      async signIn(email: string, password: string) {
        const client = supabase;
        if (!client) throw new Error("Supabase Auth no está configurado.");
        const { error: signInError } = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
      },
      async signOut() {
        const client = supabase;
        if (!client) throw new Error("Supabase Auth no está configurado.");
        const { error: signOutError } = await client.auth.signOut();
        if (signOutError) throw signOutError;
      },
      async refreshProfile() {
        const client = supabase;
        if (!client || !session) {
          throw new Error("No hay una sesión autenticada para actualizar el perfil.");
        }
        const { data, error: profileError } = await client
          .from("profiles")
          .select("id, role, display_name")
          .eq("id", session.user.id)
          .single();
        if (profileError) throw profileError;
        if (!isUserProfile(data, session.user.id)) {
          throw new Error("El perfil recibido no tiene un formato válido.");
        }
        setProfile(data);
      },
      async requestPasswordReset(email: string) {
        const client = supabase;
        if (!client) throw new Error("Supabase Auth no está configurado.");
        const redirectTo = new URL(
          "/restablecer-acceso",
          window.location.origin,
        ).toString();
        const { error: resetError } =
          await client.auth.resetPasswordForEmail(email, { redirectTo });
        if (resetError) throw resetError;
      },
      async updatePassword(password: string) {
        const client = supabase;
        if (!client || !session) {
          throw new Error("El enlace de recuperación no es válido o expiró.");
        }
        const { error: updateError } = await client.auth.updateUser({
          password,
        });
        if (updateError) throw updateError;
      },
    }),
    [error, profile, session, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
