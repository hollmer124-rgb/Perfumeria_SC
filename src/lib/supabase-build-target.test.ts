import { describe, expect, it } from "vitest";
import { assertSafeSupabaseTarget } from "./supabase-build-target";

const localEnv = {
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
  VITE_SUPABASE_ANON_KEY: "local-anon-key",
};

const productionEnv = {
  VITE_SUPABASE_URL: "https://qdkbmzfihdriykdqatde.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};

describe("assertSafeSupabaseTarget", () => {
  it("allows local development and local builds only against the local API", () => {
    for (const command of ["serve", "build"] as const) {
      expect(() =>
        assertSafeSupabaseTarget(localEnv, {
          command,
          mode: command === "serve" ? "development" : "production",
          vercel: undefined,
          vercelEnv: undefined,
        }),
      ).not.toThrow();
    }
  });

  it("rejects production from a local Vite process", () => {
    expect(() =>
      assertSafeSupabaseTarget(productionEnv, {
        command: "build",
        mode: "production",
        vercel: undefined,
        vercelEnv: undefined,
      }),
    ).toThrow(/Local Vite must target Supabase/);
  });

  it("rejects ambiguous Vercel environment variables outside Vercel", () => {
    expect(() =>
      assertSafeSupabaseTarget(localEnv, {
        command: "build",
        mode: "production",
        vercel: undefined,
        vercelEnv: "production",
      }),
    ).toThrow(/without the Vercel build marker/);
  });

  it("requires a separate project reference for Vercel Preview", () => {
    expect(() =>
      assertSafeSupabaseTarget(productionEnv, {
        command: "build",
        mode: "production",
        vercel: "1",
        vercelEnv: "preview",
      }),
    ).toThrow(/requires SUPABASE_PREVIEW_PROJECT_REF/);
  });

  it("rejects production as the Vercel Preview project", () => {
    expect(() =>
      assertSafeSupabaseTarget(
        {
          ...productionEnv,
          SUPABASE_PREVIEW_PROJECT_REF: "qdkbmzfihdriykdqatde",
        },
        {
          command: "build",
          mode: "production",
          vercel: "1",
          vercelEnv: "preview",
        },
      ),
    ).toThrow(/non-production Supabase project/);
  });

  it("requires the Preview URL to match its dedicated reference", () => {
    expect(() =>
      assertSafeSupabaseTarget(
        {
          ...productionEnv,
          SUPABASE_PREVIEW_PROJECT_REF: "stagingproject123",
        },
        {
          command: "build",
          mode: "production",
          vercel: "1",
          vercelEnv: "preview",
        },
      ),
    ).toThrow(/must match SUPABASE_PREVIEW_PROJECT_REF/);
  });

  it("allows Preview only when the URL matches its non-production reference", () => {
    expect(() =>
      assertSafeSupabaseTarget(
        {
          ...productionEnv,
          VITE_SUPABASE_URL: "https://stagingproject123.supabase.co",
          SUPABASE_PREVIEW_PROJECT_REF: "stagingproject123",
        },
        {
          command: "build",
          mode: "production",
          vercel: "1",
          vercelEnv: "preview",
        },
      ),
    ).not.toThrow();
  });

  it("allows Vercel Production only for the known production reference", () => {
    expect(() =>
      assertSafeSupabaseTarget(productionEnv, {
        command: "build",
        mode: "production",
        vercel: "1",
        vercelEnv: "production",
      }),
    ).not.toThrow();
    expect(() =>
      assertSafeSupabaseTarget(
        {
          ...productionEnv,
          VITE_SUPABASE_URL: "https://stagingproject123.supabase.co",
        },
        {
          command: "build",
          mode: "production",
          vercel: "1",
          vercelEnv: "production",
        },
      ),
    ).toThrow(/must target Supabase project/);
  });

  it("requires HTTPS for Vercel Supabase URLs", () => {
    expect(() =>
      assertSafeSupabaseTarget(
        {
          ...productionEnv,
          VITE_SUPABASE_URL: "http://qdkbmzfihdriykdqatde.supabase.co",
        },
        {
          command: "build",
          mode: "production",
          vercel: "1",
          vercelEnv: "production",
        },
      ),
    ).toThrow(/must use the HTTPS Supabase project URL/);
  });

  it("rejects service-role and secret keys", () => {
    const serviceRolePayload = btoa(JSON.stringify({ role: "service_role" }))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const serviceRoleKey = `header.${serviceRolePayload}.signature`;

    expect(() =>
      assertSafeSupabaseTarget(
        {
          ...localEnv,
          VITE_SUPABASE_ANON_KEY: serviceRoleKey,
        },
        {
          command: "serve",
          mode: "development",
          vercel: undefined,
          vercelEnv: undefined,
        },
      ),
    ).toThrow(/service-role or secret key/);
    expect(() =>
      assertSafeSupabaseTarget(
        {
          ...localEnv,
          VITE_SUPABASE_SECRET_KEY: "not-a-public-key",
        },
        {
          command: "serve",
          mode: "development",
          vercel: undefined,
          vercelEnv: undefined,
        },
      ),
    ).toThrow(/service-role or secret key/);
  });
});
