import { lazy } from "react";

export const LoginPage = lazy(() =>
  import("@/features/auth/login-page").then((module) => ({
    default: module.LoginPage,
  })),
);

export const RecoverAccessPage = lazy(() =>
  import("@/features/auth/recover-access-page").then((module) => ({
    default: module.RecoverAccessPage,
  })),
);

export const ResetAccessPage = lazy(() =>
  import("@/features/auth/reset-access-page").then((module) => ({
    default: module.ResetAccessPage,
  })),
);
