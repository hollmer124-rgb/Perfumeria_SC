import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { DashboardPage } from "@/pages/dashboard-page";
import type { DashboardMetrics } from "@/features/dashboard/types";

const { metrics } = vi.hoisted(() => ({
  metrics: {
    day_sales_cop: 125000,
    month_sales_cop: 125000,
    day_transactions: 1,
    day_gross_profit_cop: 50000,
    month_gross_profit_cop: 50000,
    month_expenses_cop: 10000,
    month_other_income_cop: 0,
    month_net_result_cop: 40000,
    previous_month_sales_cop: 0,
    month_sales_change_cop: 125000,
    timeline: [],
    top_products: [],
    low_stock_materials: [],
    low_stock_products: [],
    recent_sales: [],
    open_cash_sessions: [],
  } satisfies DashboardMetrics,
}));

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ profile: { id: "admin-id", role: "admin" } }),
}));

vi.mock("@/features/dashboard/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/dashboard/data")>();
  return {
    ...actual,
    fetchDashboardMetrics: vi.fn().mockResolvedValue(metrics),
  };
});

describe("DashboardPage", () => {
  it("shows metrics returned by the dashboard query", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findAllByText(/125\.000/)).not.toHaveLength(0);
    expect(screen.getByText("Utilidad bruta del mes")).toBeInTheDocument();
    expect(screen.getByText("No hay transacciones recientes.")).toBeInTheDocument();
  });
});
