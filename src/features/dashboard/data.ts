import { supabase } from "@/lib/supabase";
import type { DashboardMetrics, DashboardTrendReport, OperationalReport } from "@/features/dashboard/types";

export const dashboardQueryKeys = {
  metrics: ["dashboard-metrics"] as const,
  trends: ["dashboard-trends"] as const,
};

function client() {
  if (!supabase) throw new Error("Supabase no está conectado.");
  return supabase;
}

function bogotaMidnight(date: string): string {
  return new Date(`${date}T00:00:00-05:00`).toISOString();
}

export function dashboardToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Bogota",
    year: "numeric",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function previousDate(date: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  const today = dashboardToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const { data, error } = await client().rpc("dashboard_metrics", {
    p_day_start: bogotaMidnight(today),
    p_month_start: bogotaMidnight(monthStart),
    p_now: new Date().toISOString(),
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Supabase no devolvió los indicadores del dashboard.");
  }
  return data as DashboardMetrics;
}

export async function fetchDashboardTrends(): Promise<DashboardTrendReport> {
  const end = dashboardToday();
  const startDate = new Date(`${end}T12:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() - 29);
  const start = startDate.toISOString().slice(0, 10);
  return fetchOperationalReport({
    start,
    end,
    bucket: "day",
  });
}

export async function fetchOperationalReport(input: {
  start: string;
  end: string;
  bucket: "day" | "week" | "month";
  productId?: string;
  category?: string;
  employeeId?: string;
  compareStart?: string;
  compareEnd?: string;
}): Promise<OperationalReport> {
  const endExclusive = new Date(`${input.end}T00:00:00-05:00`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const params = {
    p_start: bogotaMidnight(input.start),
    p_end: endExclusive.toISOString(),
    p_bucket: input.bucket,
    p_product_id: input.productId || null,
    p_category: input.category || null,
    p_employee_id: input.employeeId || null,
    p_compare_start: input.compareStart ? bogotaMidnight(input.compareStart) : null,
    p_compare_end: input.compareEnd
      ? new Date(`${input.compareEnd}T00:00:00-05:00`).toISOString()
      : null,
  };
  const { data, error } = await client().rpc("admin_operational_report", params);
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Supabase no devolvió el informe operativo.");
  }
  return data as OperationalReport;
}

export function previousDay(date: string) {
  return previousDate(date);
}

export function previousPeriod(start: string, end: string) {
  const startDate = new Date(`${start}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);
  const duration = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
  const previousEnd = previousDate(start);
  const previousStart = new Date(`${previousEnd}T12:00:00Z`);
  previousStart.setUTCDate(previousStart.getUTCDate() - duration + 1);
  return {
    start: previousStart.toISOString().slice(0, 10),
    end: previousEnd,
  };
}
