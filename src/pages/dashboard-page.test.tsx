import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { DashboardPage } from "@/pages/dashboard-page";

describe("DashboardPage", () => {
  it("shows a provisional empty state without fabricated activity", () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Cada detalle, en su lugar." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no se muestran registros de ejemplo/i),
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText(/sin datos/i)).toHaveLength(4);
  });
});
