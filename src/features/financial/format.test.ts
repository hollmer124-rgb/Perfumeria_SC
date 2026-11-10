import { describe, expect, it } from "vitest";
import { bogotaDateInputValue } from "@/features/financial/format";

describe("financial date formatting", () => {
  it("uses the business date in America/Bogota rather than the browser timezone", () => {
    expect(bogotaDateInputValue(new Date("2026-11-10T02:00:00.000Z"))).toBe("2026-11-09");
  });
});
