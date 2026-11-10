import type { PaymentMethod } from "@/features/sales/types";

export type CashMovementType =
  | "opening"
  | "sale_in"
  | "expense_out"
  | "deposit"
  | "withdrawal"
  | "closing_adjustment";

export interface CashSession {
  id: string;
  opened_by: string;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  opening_cop: number;
  expected_cop: number;
  counted_cop: number | null;
  difference_cop: number | null;
  sales_total_cop: number;
  sales_by_method: Partial<Record<PaymentMethod, number>>;
  notes: string | null;
}

export interface CashClosureResult {
  difference_cop: number;
  sales_total_cop: number;
  sales_by_method: Partial<Record<PaymentMethod, number>>;
}

export interface CashMovement {
  id: string;
  cash_session_id: string;
  movement_type: CashMovementType;
  amount_cop: number;
  signed_amount_cop: number;
  description: string | null;
  created_by: string | null;
  created_at: string;
  sale_id: string | null;
  expense_id: string | null;
  income_id: string | null;
}

export interface CashSale {
  id: string;
  cash_session_id: string | null;
  payment_method: PaymentMethod;
  total_cop: number;
  status: "completed" | "voided";
  created_at: string;
}

export interface FinancialIncome {
  id: string;
  created_by: string;
  cash_session_id: string;
  description: string;
  amount_cop: number;
  income_date: string;
  payment_method: PaymentMethod;
  notes: string | null;
  created_at: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  active: boolean;
}

export interface ExpenseRecord {
  id: string;
  created_by: string;
  category_id: string | null;
  description: string;
  amount_cop: number;
  expense_date: string;
  payment_method: PaymentMethod;
  cash_session_id: string | null;
  notes: string | null;
  created_at: string;
  expense_categories: { id: string; name: string } | null;
}

export interface FinancialReport {
  sales_cop: number;
  sales_cost_cop: number;
  gross_profit_cop: number;
  operating_expenses_cop: number;
  other_income_cop: number;
  net_result_cop: number;
  sale_count: number;
  sales_by_method: Partial<Record<PaymentMethod, number>>;
  expenses_by_category: Array<{ category: string | null; amount_cop: number }>;
}
