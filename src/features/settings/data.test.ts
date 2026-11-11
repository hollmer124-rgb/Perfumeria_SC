import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchBusinessSettings,
  updateBusinessSettings,
} from "@/features/settings/data";

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMocks,
}));

function createQuery(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    update: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.update.mockReturnValue(query);
  return query;
}

describe("business settings data access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses maybeSingle and treats a missing singleton as an empty result", async () => {
    const query = createQuery({ data: null, error: null });
    supabaseMocks.from.mockReturnValue(query);

    await expect(fetchBusinessSettings()).resolves.toBeNull();
    expect(supabaseMocks.from).toHaveBeenCalledWith("business_settings");
    expect(query.select).toHaveBeenCalledWith(
      "id, business_name, phone, email, address, updated_at",
    );
    expect(query.eq).toHaveBeenCalledWith("id", 1);
    expect(query.maybeSingle).toHaveBeenCalledOnce();
  });

  it("preserves the original Supabase error and logs only safe diagnostics", async () => {
    const error = Object.assign(new Error("Schema cache lookup failed"), {
      code: "PGRST205",
      status: 404,
    });
    const query = createQuery({ data: null, error });
    supabaseMocks.from.mockReturnValue(query);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(fetchBusinessSettings()).rejects.toBe(error);
    expect(log).toHaveBeenCalledWith("Business settings fetch failed", {
      code: "PGRST205",
      message: "Schema cache lookup failed",
      status: 404,
    });
    log.mockRestore();
  });

  it("updates only the singleton row and treats a filtered update as failure", async () => {
    const query = createQuery({ data: null, error: null });
    supabaseMocks.from.mockReturnValue(query);

    await expect(
      updateBusinessSettings({
        business_name: "Updated business",
        phone: null,
        email: null,
        address: null,
      }),
    ).rejects.toThrow(/no se encontró la configuración/i);
    expect(query.update).toHaveBeenCalledWith({
      business_name: "Updated business",
      phone: null,
      email: null,
      address: null,
    });
    expect(query.eq).toHaveBeenCalledWith("id", 1);
  });
});
