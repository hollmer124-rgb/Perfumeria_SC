export const copFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export const quantityFormatter = new Intl.NumberFormat("es-CO", {
  maximumFractionDigits: 4,
});

export function formatCop(value: number): string {
  return copFormatter.format(value);
}

export function formatQuantity(value: number): string {
  return quantityFormatter.format(value);
}

export function localDateInputValue(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}
