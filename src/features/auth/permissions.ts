export type AppRole = "admin" | "employee";

export const employeeAllowedPaths = new Set([
  "/dashboard",
  "/ventas",
  "/inventario",
  "/clientes",
  "/caja",
]);

export function canAccessPath(role: AppRole, path: string): boolean {
  return role === "admin" || employeeAllowedPaths.has(path);
}

export function roleLabel(role: AppRole): string {
  return role === "admin" ? "Administrador" : "Empleado";
}
