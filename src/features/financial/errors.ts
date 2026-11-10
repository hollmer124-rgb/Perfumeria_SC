export function financialErrorMessage(error: unknown, fallback: string): string {
  if (import.meta.env.DEV) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : undefined;
    console.error("Financial operation failed", {
      name: error instanceof Error ? error.name : undefined,
      code,
    });
    if (error instanceof Error) return error.message;
    if (typeof error === "object" && error !== null && "message" in error) {
      return String(error.message);
    }
    return fallback;
  }
  return fallback;
}
