import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "@/features/settings/settings-page";
import type { BusinessSettings } from "@/features/settings/data";

const mocks = vi.hoisted(() => ({
  auth: {
    role: "admin" as "admin" | "employee",
    userId: "settings-test-user",
  },
  fetchBusinessSettings: vi.fn(),
  updateBusinessSettings: vi.fn(),
  fetchStaffProfiles: vi.fn(),
  fetchAccountProfile: vi.fn(),
  refreshProfile: vi.fn(),
}));

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: mocks.auth.userId,
        email: "settings-test@example.test",
      },
    },
    profile: {
      id: mocks.auth.userId,
      role: mocks.auth.role,
      display_name: "Settings test user",
    },
    refreshProfile: mocks.refreshProfile,
  }),
}));

vi.mock("@/features/settings/data", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/settings/data")>();
  return {
    ...actual,
    fetchBusinessSettings: mocks.fetchBusinessSettings,
    updateBusinessSettings: mocks.updateBusinessSettings,
    fetchStaffProfiles: mocks.fetchStaffProfiles,
    fetchAccountProfile: mocks.fetchAccountProfile,
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { updateUser: vi.fn().mockResolvedValue({ error: null }) },
    from: vi.fn(),
  },
}));

const initialSettings: BusinessSettings = {
  id: 1,
  business_name: "Perfumeria de prueba",
  phone: null,
  email: null,
  address: null,
  updated_at: "2026-11-11T12:00:00.000Z",
};

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

describe("business settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.role = "admin";
    mocks.auth.userId = "settings-test-user";
    mocks.fetchBusinessSettings.mockResolvedValue(initialSettings);
    mocks.updateBusinessSettings.mockResolvedValue(undefined);
    mocks.fetchStaffProfiles.mockResolvedValue([]);
    mocks.fetchAccountProfile.mockResolvedValue({
      ...initialSettings,
      id: mocks.auth.userId,
      display_name: "Settings test user",
      role: "admin",
      created_at: initialSettings.updated_at,
    });
  });

  it("loads saved values for an administrator and persists edits", async () => {
    let persisted = { ...initialSettings };
    mocks.fetchBusinessSettings.mockImplementation(async () => persisted);
    mocks.updateBusinessSettings.mockImplementation(async (values) => {
      persisted = {
        ...persisted,
        ...values,
        updated_at: "2026-11-11T13:00:00.000Z",
      };
    });

    renderSettings();

    const nameInput = await screen.findByDisplayValue("Perfumeria de prueba");
    fireEvent.change(nameInput, { target: { value: "Perfumeria actualizada" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar datos" }));

    await waitFor(() =>
      expect(mocks.updateBusinessSettings).toHaveBeenCalledWith({
        business_name: "Perfumeria actualizada",
        phone: null,
        email: null,
        address: null,
      }),
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue("Perfumeria actualizada")).toBeInTheDocument(),
    );
  });

  it("lets an employee read saved values without showing edit controls", async () => {
    mocks.auth.role = "employee";
    renderSettings();

    expect(await screen.findByText("Perfumeria de prueba")).toBeInTheDocument();
    expect(
      screen.getByText("Solo un administrador puede modificar estos datos."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Guardar datos" }),
    ).not.toBeInTheDocument();
    expect(mocks.updateBusinessSettings).not.toHaveBeenCalled();
  });

  it("shows a clear empty state when the singleton row is absent", async () => {
    mocks.fetchBusinessSettings.mockResolvedValue(null);
    renderSettings();

    expect(
      await screen.findByText("La configuración del negocio aún no está inicializada."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No se creó ningún registro automáticamente/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No se pudo cargar la configuración del negocio."),
    ).not.toBeInTheDocument();
  });

  it("shows a query error and retries the request successfully", async () => {
    mocks.fetchBusinessSettings
      .mockRejectedValueOnce(
        Object.assign(new Error("Local query failed"), {
          code: "PGRST205",
          status: 404,
        }),
      )
      .mockResolvedValueOnce(initialSettings);
    renderSettings();

    fireEvent.click(
      await screen.findByRole("button", { name: "Reintentar" }),
    );

    expect(await screen.findByDisplayValue("Perfumeria de prueba")).toBeInTheDocument();
    expect(mocks.fetchBusinessSettings).toHaveBeenCalledTimes(2);
  });
});
