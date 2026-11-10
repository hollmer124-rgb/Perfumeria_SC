import { Suspense, type ReactNode } from "react";
import { Navigate, createBrowserRouter } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { DashboardPage } from "@/pages/dashboard-page";
import { ModulePage } from "@/pages/module-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { adminModules } from "@/features/navigation/navigation-items";
import {
  LoginPage,
  RecoverAccessPage,
  ResetAccessPage,
} from "@/features/auth/lazy-pages";
import {
  AuthLoading,
  GuestRoute,
  ProtectedRoute,
  RequireRole,
} from "@/features/auth/auth-guards";
import { employeeAllowedPaths } from "@/features/auth/permissions";

function authPage(element: ReactNode) {
  return <Suspense fallback={<AuthLoading />}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  {
    path: "/login",
    element: authPage(<LoginPage />),
  },
  {
    path: "/recuperar-acceso",
    element: authPage(
      <GuestRoute>
        <RecoverAccessPage />
      </GuestRoute>,
    ),
  },
  {
    path: "/restablecer-acceso",
    element: authPage(<ResetAccessPage />),
  },
  {
    path: "/",
    element: <Navigate to="/dashboard" replace />,
  },
  {
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { path: "dashboard", element: <DashboardPage /> },
      ...adminModules.map((module) => ({
        path: module.path.slice(1),
        element: (
          <RequireRole
            allowedRoles={
              employeeAllowedPaths.has(module.path)
                ? ["admin", "employee"]
                : ["admin"]
            }
          >
            <ModulePage module={module} />
          </RequireRole>
        ),
      })),
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
