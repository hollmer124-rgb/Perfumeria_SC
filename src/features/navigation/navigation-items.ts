import {
  Boxes,
  ChartNoAxesCombined,
  FlaskConical,
  LayoutDashboard,
  Package,
  ReceiptText,
  Settings2,
  ShoppingBag,
  Truck,
  Users,
  WalletCards,
} from "lucide-react";
import type { AdminNavigationGroup } from "@/types/navigation";

export const navigationGroups: AdminNavigationGroup[] = [
  {
    label: "General",
    items: [
      {
        path: "/dashboard",
        title: "Dashboard",
        description: "Resumen de administración y accesos a los módulos.",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    label: "Operación",
    items: [
      {
        path: "/ventas",
        title: "Ventas",
        description: "Punto de venta y registro de pedidos.",
        icon: ShoppingBag,
      },
      {
        path: "/productos",
        title: "Productos",
        description: "Catálogo y referencias de perfumería.",
        icon: Package,
      },
      {
        path: "/inventario",
        title: "Inventario",
        description: "Existencias de productos y materiales.",
        icon: Boxes,
      },
      {
        path: "/recetas",
        title: "Recetas",
        description: "Composición y presentaciones de réplicas.",
        icon: FlaskConical,
      },
      {
        path: "/compras",
        title: "Compras",
        description: "Abastecimiento y registro de compras.",
        icon: ReceiptText,
      },
    ],
  },
  {
    label: "Directorio",
    items: [
      {
        path: "/clientes",
        title: "Clientes",
        description: "Directorio y datos de clientes.",
        icon: Users,
      },
      {
        path: "/proveedores",
        title: "Proveedores",
        description: "Directorio de proveedores.",
        icon: Truck,
      },
    ],
  },
  {
    label: "Finanzas",
    items: [
      {
        path: "/gastos",
        title: "Gastos",
        description: "Registro y consulta de gastos.",
        icon: ReceiptText,
      },
      {
        path: "/caja",
        title: "Caja",
        description: "Control de caja y movimientos.",
        icon: WalletCards,
      },
      {
        path: "/informes",
        title: "Informes",
        description: "Indicadores e informes del negocio.",
        icon: ChartNoAxesCombined,
      },
    ],
  },
  {
    label: "Sistema",
    items: [
      {
        path: "/configuracion",
        title: "Configuración",
        description: "Preferencias generales de la aplicación.",
        icon: Settings2,
      },
    ],
  },
];

export const allNavigationItems = navigationGroups.flatMap(
  (group) => group.items,
);

export const adminModules = allNavigationItems.filter(
  (item) => item.path !== "/dashboard",
);

export const quickAccessModules = adminModules.slice(0, 4);
