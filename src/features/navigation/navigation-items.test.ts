import { describe, expect, it } from "vitest";
import {
  allNavigationItems,
  getNavigationGroupsForRole,
} from "@/features/navigation/navigation-items";

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

  it("limits employee navigation to operational routes", () => {
    const paths = getNavigationGroupsForRole("employee").flatMap((group) =>
      group.items.map((item) => item.path),
    );

    expect(paths).toEqual([
      "/dashboard",
      "/ventas",
      "/inventario",
      "/clientes",
      "/caja",
    ]);
  });
});
