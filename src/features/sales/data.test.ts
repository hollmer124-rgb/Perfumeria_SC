import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerPosSale } from "@/features/sales/data";

const supabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMocks,
}));

describe("registerPosSale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the stable idempotency key and the full cart to the transactional RPC", async () => {
    const saleId = "a0000000-0000-4000-8000-000000000001";
    supabaseMocks.rpc.mockResolvedValue({ data: saleId, error: null });
    const input = {
      items: [{
        kind: "recipe" as const,
        id: "b0000000-0000-4000-8000-000000000001",
        quantity: 2,
        fill_consumption_ml: 11.25,
      }],
      payment_method: "cash" as const,
      idempotency_key: "c0000000-0000-4000-8000-000000000001",
      discount_cop: 12500,
      customer_id: null,
      cash_session_id: "d0000000-0000-4000-8000-000000000001",
      notes: "  Venta de prueba  ",
    };

    await expect(registerPosSale(input)).resolves.toBe(saleId);
    expect(supabaseMocks.rpc).toHaveBeenCalledWith("register_pos_sale", {
      p_items: input.items,
      p_payment_method: input.payment_method,
      p_idempotency_key: input.idempotency_key,
      p_discount_cop: input.discount_cop,
      p_customer_id: input.customer_id,
      p_cash_session_id: input.cash_session_id,
      p_notes: "Venta de prueba",
    });
  });

  it("surfaces database errors instead of reporting a successful sale", async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: null,
      error: new Error("Stock insufficient"),
    });

    await expect(registerPosSale({
      items: [{
        kind: "retail_product",
        id: "b0000000-0000-4000-8000-000000000002",
        quantity: 1,
        fill_consumption_ml: null,
      }],
      payment_method: "transfer",
      idempotency_key: "c0000000-0000-4000-8000-000000000002",
      discount_cop: 0,
      customer_id: null,
      cash_session_id: null,
      notes: "",
    })).rejects.toThrow("Stock insufficient");
  });
});
