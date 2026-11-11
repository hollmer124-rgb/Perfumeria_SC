import { afterEach, describe, expect, it, vi } from "vitest";
import { operationErrorMessage } from "@/lib/operation-error";

describe("operationErrorMessage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses a safe fallback outside development", () => {
    vi.stubEnv("DEV", false);

    expect(
      operationErrorMessage(
        Object.assign(new Error("Database internals"), { code: "42501" }),
        "No se pudo guardar.",
        "Saving operation failed",
      ),
    ).toBe("No se pudo guardar.");
  });

  it("preserves actionable details in development without logging error data", () => {
    vi.stubEnv("DEV", true);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = Object.assign(new Error("Permission denied"), {
      code: "42501",
      details: "Sensitive row detail",
    });

    expect(
      operationErrorMessage(error, "No se pudo guardar.", "Saving operation failed"),
    ).toBe("Permission denied");
    expect(log).toHaveBeenCalledWith("Saving operation failed", {
      name: "Error",
      code: "42501",
    });
    expect(log).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ details: expect.anything() }),
    );
  });
});
