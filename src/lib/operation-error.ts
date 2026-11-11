export function operationErrorMessage(
  error: unknown,
  fallback: string,
  context: string,
): string {
  if (import.meta.env.DEV) {
    const record = typeof error === "object" && error !== null
      ? error as Record<string, unknown>
      : null;
    console.error(context, {
      name: error instanceof Error ? error.name : undefined,
      code: typeof record?.code === "string" ? record.code : undefined,
    });
    if (error instanceof Error) return error.message;
    if (typeof record?.message === "string") return record.message;
  }
  return fallback;
}
