import { describe, expect, it } from "vitest";
import { allNavigationItems } from "@/features/navigation/navigation-items";

describe("admin navigation", () => {
  it("defines every requested route exactly once", () => {
    const paths = allNavigationItems.map(({ path }) => path);

    expect(paths).toEqual([
      "/dashboard",
      "/ventas",
      "/productos",
      "/inventario",
      "/recetas",
      "/compras",
      "/clientes",
      "/proveedores",
      "/gastos",
      "/caja",
      "/informes",
      "/configuracion",
    ]);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
