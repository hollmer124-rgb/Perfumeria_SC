import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OlfactoryReferencesPage } from "@/features/inventory/olfactory-references-page";
import type { Perfume } from "@/features/inventory/types";

const mocks = vi.hoisted(() => ({
  fetchPerfumes: vi.fn(),
  savePerfumeReference: vi.fn(),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock("@/features/inventory/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/inventory/data")>();
  return {
    ...actual,
    fetchPerfumes: mocks.fetchPerfumes,
    savePerfumeReference: mocks.savePerfumeReference,
  };
});

vi.mock("@/lib/notifications", () => ({
  notify: {
    error: mocks.notifyError,
    success: mocks.notifySuccess,
  },
}));

const reference: Perfume = {
  id: "reference-1",
  name: "Aroma de prueba",
  brand: "Marca de prueba",
  description: "Referencia inicial.",
  active: true,
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <OlfactoryReferencesPage />
    </QueryClientProvider>,
  );
}

describe("olfactory references", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchPerfumes.mockResolvedValue([]);
    mocks.savePerfumeReference.mockResolvedValue(undefined);
  });

  it("creates a reference independently of a finished product", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Nueva referencia" }));

    fireEvent.change(await screen.findByLabelText("Nombre", { exact: false }), {
      target: { value: "Sauvage" },
    });
    fireEvent.change(await screen.findByLabelText("Marca", { exact: false }), {
      target: { value: "Dior" },
    });
    fireEvent.change(await screen.findByLabelText("Descripción"), {
      target: { value: "Referencia olfativa." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar referencia" }));

    await waitFor(() =>
      expect(mocks.savePerfumeReference).toHaveBeenCalledWith(null, {
        name: "Sauvage",
        brand: "Dior",
        description: "Referencia olfativa.",
        active: true,
      }),
    );
    expect(mocks.notifySuccess).toHaveBeenCalledWith(
      "Referencia olfativa guardada.",
    );
  });

  it("lists, searches, and edits an existing reference", async () => {
    mocks.fetchPerfumes.mockResolvedValue([reference]);
    renderPage();

    expect(await screen.findByText("Aroma de prueba")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar referencias olfativas"), {
      target: { value: "marca de prueba" },
    });
    expect(screen.getByText("Aroma de prueba")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Editar Aroma de prueba" }));
    fireEvent.change(await screen.findByLabelText("Nombre", { exact: false }), {
      target: { value: "Aroma actualizado" },
    });
    fireEvent.change(screen.getByLabelText("Estado"), {
      target: { value: "false" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar referencia" }));

    await waitFor(() =>
      expect(mocks.savePerfumeReference).toHaveBeenCalledWith("reference-1", {
        name: "Aroma actualizado",
        brand: "Marca de prueba",
        description: "Referencia inicial.",
        active: false,
      }),
    );
  });

  it("shows a clear duplicate message from the database", async () => {
    mocks.savePerfumeReference.mockRejectedValue(
      Object.assign(new Error("duplicate key"), { code: "23505" }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Nueva referencia" }));
    fireEvent.change(await screen.findByLabelText("Nombre", { exact: false }), {
      target: { value: "Aroma repetido" },
    });
    fireEvent.change(await screen.findByLabelText("Marca", { exact: false }), {
      target: { value: "Marca repetida" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar referencia" }));

    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "Ya existe una referencia con esta marca y este nombre.",
      ),
    );
  });
});
