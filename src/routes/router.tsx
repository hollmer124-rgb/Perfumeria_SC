import { Navigate, createBrowserRouter } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { DashboardPage } from "@/pages/dashboard-page";
import { ModulePage } from "@/pages/module-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { adminModules } from "@/features/navigation/navigation-items";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/dashboard" replace />,
  },
  {
    element: <AppShell />,
    children: [
      { path: "dashboard", element: <DashboardPage /> },
      ...adminModules.map((module) => ({
        path: module.path.slice(1),
        element: <ModulePage module={module} />,
      })),
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
