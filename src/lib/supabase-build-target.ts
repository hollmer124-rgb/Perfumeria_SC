const productionProjectRef = "qdkbmzfihdriykdqatde";

type ViteCommand = "build" | "serve";

interface ViteRuntime {
  command: ViteCommand;
  mode: string;
  vercel: string | undefined;
  vercelEnv: string | undefined;
}

type Environment = Record<string, string | undefined>;

function fail(message: string): never {
  throw new Error(`[Supabase environment] ${message}`);
}

function getProjectRef(url: URL): string | null {
  const match = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
  return match?.[1] ?? null;
}

function getJwtRole(key: string): string | null {
  const segments = key.split(".");
  if (segments.length !== 3) return null;

  const payload = segments[1].replace(/-/g, "+").replace(/_/g, "/");
  const paddedPayload = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");

  try {
    const claims: unknown = JSON.parse(atob(paddedPayload));
    if (typeof claims !== "object" || claims === null || !("role" in claims)) {
      return null;
    }
    return typeof claims.role === "string" ? claims.role : null;
  } catch {
    return fail("VITE_SUPABASE key is malformed; use the local anon or publishable key.");
  }
}

function isLocalSupabase(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(url.hostname) &&
    url.port === "54321"
  );
}

export function assertSafeSupabaseTarget(
  env: Environment,
  runtime: ViteRuntime,
): void {
  const urlValue = env.VITE_SUPABASE_URL?.trim();
  const key =
    env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    env.VITE_SUPABASE_ANON_KEY?.trim();

  if (!urlValue || !key) {
    fail(
      "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY) must be configured.",
    );
  }

  if (
    Object.keys(env).some((name) =>
      /^VITE_.*(SERVICE_ROLE|SECRET)/i.test(name),
    ) ||
    key.startsWith("sb_secret_") ||
    getJwtRole(key) === "service_role"
  ) {
    fail("A service-role or secret key must never be exposed to the browser.");
  }

  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    fail("VITE_SUPABASE_URL must be a valid URL.");
  }

  if (url.username || url.password) {
    fail("VITE_SUPABASE_URL must not contain credentials.");
  }

  const projectRef = getProjectRef(url);

  if (runtime.vercel === "1") {
    if (!runtime.vercelEnv || runtime.command !== "build") {
      fail("Vercel deployment context is incomplete or ambiguous.");
    }
    if (url.protocol !== "https:" || url.port) {
      fail("Vercel deployments must use the HTTPS Supabase project URL.");
    }

    if (runtime.vercelEnv === "production") {
      if (projectRef !== productionProjectRef) {
        fail(
          `Vercel Production must target Supabase project ${productionProjectRef}.`,
        );
      }
      return;
    }

    if (runtime.vercelEnv === "preview") {
      const previewProjectRef = env.SUPABASE_PREVIEW_PROJECT_REF?.trim();
      if (!previewProjectRef) {
        fail(
          "Vercel Preview requires SUPABASE_PREVIEW_PROJECT_REF and a dedicated Supabase project.",
        );
      }
      if (
        !/^[a-z0-9]+$/i.test(previewProjectRef) ||
        previewProjectRef === productionProjectRef
      ) {
        fail(
          "SUPABASE_PREVIEW_PROJECT_REF must identify a non-production Supabase project.",
        );
      }
      if (projectRef !== previewProjectRef) {
        fail(
          "VITE_SUPABASE_URL must match SUPABASE_PREVIEW_PROJECT_REF in Vercel Preview.",
        );
      }
      return;
    }

    fail("Vercel builds are allowed only for Preview or Production.");
  }

  if (runtime.vercel !== undefined || runtime.vercelEnv !== undefined) {
    fail("Vercel environment variables are present without the Vercel build marker.");
  }

  if (!isLocalSupabase(url)) {
    fail(
      `Local Vite must target Supabase at http://127.0.0.1:54321 or http://localhost:54321; received project ${projectRef ?? "unknown"}.`,
    );
  }
}
