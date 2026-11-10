import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/features/auth/auth-provider";
import { LoginPage } from "@/features/auth/login-page";
import { RecoverAccessPage } from "@/features/auth/recover-access-page";
import {
  ProtectedRoute,
  RequireRole,
} from "@/features/auth/auth-guards";

const authMocks = vi.hoisted(() => {
  const state: {
    session: { user: { id: string } } | null;
    role: "admin" | "employee";
  } = {
    session: null,
    role: "employee",
  };

  const client = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: state.session },
        error: null,
      })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: state.session
              ? {
                  id: state.session.user.id,
                  role: state.role,
                  display_name: "Cuenta de prueba",
                }
              : null,
            error: null,
          })),
        })),
      })),
    })),
  };

  return { state, client };
});

vi.mock("@/lib/supabase", () => ({
  initializeSupabase: vi.fn(async () => authMocks.client),
  isSupabaseConfigured: vi.fn(() => true),
  supabase: authMocks.client,
}));

function renderProtectedPath(path: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<p>Inicio de sesión</p>} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <RequireRole allowedRoles={["admin", "employee"]}>
                  <p>Dashboard operativo</p>
                </RequireRole>
              </ProtectedRoute>
            }
          />
          <Route
            path="/ventas"
            element={
              <ProtectedRoute>
                <RequireRole allowedRoles={["admin", "employee"]}>
                  <p>Punto de venta</p>
                </RequireRole>
              </ProtectedRoute>
            }
          />
          <Route
            path="/recetas"
            element={
              <ProtectedRoute>
                <RequireRole allowedRoles={["admin", "employee"]}>
                  <p>Consulta de recetas activas</p>
                </RequireRole>
              </ProtectedRoute>
            }
          />
          <Route
            path="/configuracion"
            element={
              <ProtectedRoute>
                <RequireRole allowedRoles={["admin"]}>
                  <p>Configuración privada</p>
                </RequireRole>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

function renderAuthPage(path: string, page: React.ReactNode) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={page} />
          <Route path="/dashboard" element={<p>Panel autenticado</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("protected routes", () => {
  beforeEach(() => {
    authMocks.state.role = "employee";
    authMocks.state.session = {
      user: { id: "11000000-0000-4000-8000-000000000002" },
    };
  });

  it("redirects direct protected-route access to login without a session", async () => {
    authMocks.state.session = null;
    renderProtectedPath("/configuracion");

    expect(await screen.findByText("Inicio de sesión")).toBeInTheDocument();
    expect(screen.queryByText("Configuración privada")).not.toBeInTheDocument();
  });

  it("rejects an employee opening an administrative route directly", async () => {
    renderProtectedPath("/configuracion");

    expect(await screen.findByText("Dashboard operativo")).toBeInTheDocument();
    expect(screen.queryByText("Configuración privada")).not.toBeInTheDocument();
  });

  it("allows an employee to open the point of sale directly", async () => {
    renderProtectedPath("/ventas");

    expect(await screen.findByText("Punto de venta")).toBeInTheDocument();
  });

  it("allows an employee to open active recipe consultation directly", async () => {
    renderProtectedPath("/recetas");

    expect(await screen.findByText("Consulta de recetas activas")).toBeInTheDocument();
  });

  it("allows an administrator to open administrative routes", async () => {
    authMocks.state.role = "admin";
    renderProtectedPath("/configuracion");

    expect(
      await screen.findByText("Configuración privada"),
    ).toBeInTheDocument();
  });

  it("authenticates through Supabase without offering public registration", async () => {
    authMocks.state.session = null;
    authMocks.client.auth.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: null,
    });
    renderAuthPage("/login", <LoginPage />);

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "employee@example.com" },
    });
    fireEvent.change(screen.getByLabelText(/Contraseña/), {
      target: { value: "a-secure-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));

    expect(await screen.findByText("Panel autenticado")).toBeInTheDocument();
    expect(
      authMocks.client.auth.signInWithPassword,
    ).toHaveBeenCalledWith({
      email: "employee@example.com",
      password: "a-secure-password",
    });
    expect(screen.queryByText(/crear cuenta|registrarse/i)).not.toBeInTheDocument();
  });

  it("requests a recovery link with an in-app redirect", async () => {
    authMocks.state.session = null;
    authMocks.client.auth.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: null,
    });
    renderAuthPage("/recuperar-acceso", <RecoverAccessPage />);

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "employee@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Enviar enlace de recuperación" }),
    );

    expect(
      await screen.findByRole("status"),
    ).toHaveTextContent(/si existe una cuenta asociada/i);
    expect(
      authMocks.client.auth.resetPasswordForEmail,
    ).toHaveBeenCalledWith(
      "employee@example.com",
      expect.objectContaining({
        redirectTo: `${window.location.origin}/restablecer-acceso`,
      }),
    );
  });
});
