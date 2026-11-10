import { createContext } from "react";
import type { Session } from "@supabase/supabase-js";
import type { AppRole } from "@/features/auth/permissions";

export interface UserProfile {
  id: string;
  role: AppRole;
  display_name: string;
}

export type AuthStatus = "initializing" | "ready" | "not_configured" | "error";

export interface AuthContextValue {
  session: Session | null;
  profile: UserProfile | null;
  status: AuthStatus;
  error: string | null;
  isConfigured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
