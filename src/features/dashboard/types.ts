import type { PaymentMethod } from "@/features/sales/types";

export interface DashboardTopProduct {
  name: string;
  category: "original" | "1.1" | "replica";
  units: number;
  sales_cop: number;
}

export interface DashboardLowStockMaterial {
  id: string;
  name: string;
  category: string;
  unit: string;
  on_hand: number;
  minimum: number;
}

export interface DashboardLowStockProduct {
  id: string;
  name: string;
  category: "original" | "1.1";
  on_hand: number;
  minimum: number;
}

export interface DashboardRecentSale {
  id: string;
  sale_number: number;
  total_cop: number;
  payment_method: PaymentMethod;
  created_at: string;
  created_by: string;
  cost_cop: number | null;
}

export interface DashboardCashSession {
  id: string;
  opened_at: string;
  expected_cop: number;
}

export interface DashboardMetrics {
  day_sales_cop: number;
  month_sales_cop: number;
  day_transactions: number;
  day_gross_profit_cop: number | null;
  month_gross_profit_cop: number | null;
  month_expenses_cop: number | null;
  month_other_income_cop: number | null;
  month_net_result_cop: number | null;
  previous_month_sales_cop: number;
  month_sales_change_cop: number;
  timeline: DashboardSeriesPoint[];
  top_products: DashboardTopProduct[];
  low_stock_materials: DashboardLowStockMaterial[];
  low_stock_products: DashboardLowStockProduct[];
  recent_sales: DashboardRecentSale[];
  open_cash_sessions: DashboardCashSession[];
}

export interface DashboardSeriesPoint {
  period: string;
  sales_cop: number;
  transactions: number;
  historical_cost_cop: number;
}

export interface DashboardTrendReport {
  summary: {
    sales_cop: number;
    sales_cost_cop: number;
    gross_profit_cop: number;
    operating_expenses_cop: number;
    other_income_cop: number;
    net_result_cop: number;
    sale_count: number;
  };
  timeline: DashboardSeriesPoint[];
}

export interface OperationalReport {
  summary: DashboardTrendReport["summary"];
  comparison: {
    sales_cop: number;
    sales_cost_cop: number;
    transactions: number;
  } | null;
  timeline: DashboardSeriesPoint[];
  sales_by_category: Array<{ category: string; sales_cop: number; units: number }>;
  sales_by_type: Array<{
    category: string;
    sales_cop: number;
    historical_cost_cop: number;
    units: number;
  }>;
  top_products: Array<{
    name: string;
    category: string;
    units: number;
    sales_cop: number;
    historical_cost_cop: number;
  }>;
  material_consumption: Array<{
    material: string;
    unit: string;
    quantity_used: number;
    historical_cost_cop: number;
  }>;
  purchases: Array<{
    id: string;
    status: string;
    purchased_at: string;
    received_at: string | null;
    total_cop: number;
    created_by: string;
    item_count: number;
  }>;
  expenses_by_category: Array<{ category: string; amount_cop: number }>;
  cash_movements: Array<{
    movement_type: string;
    amount_cop: number;
    movement_count: number;
  }>;
}
