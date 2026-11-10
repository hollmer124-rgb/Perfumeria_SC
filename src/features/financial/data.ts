import { supabase } from "@/lib/supabase";
import type { PaymentMethodOption } from "@/features/sales/types";
import type {
  CashMovement,
  CashSale,
  CashClosureResult,
  CashSession,
  ExpenseCategory,
  ExpenseRecord,
  FinancialIncome,
  FinancialReport,
} from "@/features/financial/types";

export const financialQueryKeys = {
  sessions: ["financial-cash-sessions"] as const,
  methods: ["financial-payment-methods"] as const,
  expenses: ["financial-expenses"] as const,
  categories: ["financial-expense-categories"] as const,
  report: ["financial-report"] as const,
};

function client() {
  if (!supabase) throw new Error("Supabase no está conectado.");
  return supabase;
}

export interface CashOverview {
  sessions: CashSession[];
  movements: CashMovement[];
  sales: CashSale[];
  incomes: FinancialIncome[];
}

export async function fetchCashOverview(): Promise<CashOverview> {
  const db = client();
  const { data: sessions, error: sessionError } = await db
    .from("cash_sessions")
    .select(
      "id, opened_by, status, opened_at, closed_at, opening_cop, expected_cop, counted_cop, difference_cop, sales_total_cop, sales_by_method, notes",
    )
    .order("opened_at", { ascending: false })
    .limit(60);
  if (sessionError) throw sessionError;
  const sessionRows = (sessions ?? []) as CashSession[];
  if (!sessionRows.length) {
    return { sessions: [], movements: [], sales: [], incomes: [] };
  }
  const ids = sessionRows.map((session) => session.id);
  const [movementResult, saleResult, incomeResult] = await Promise.all([
    db
      .from("cash_movements")
      .select(
        "id, cash_session_id, movement_type, amount_cop, signed_amount_cop, description, created_by, created_at, sale_id, expense_id, income_id",
      )
      .in("cash_session_id", ids)
      .order("created_at", { ascending: false }),
    db
      .from("sales")
      .select("id, cash_session_id, payment_method, total_cop, status, created_at")
      .in("cash_session_id", ids)
      .order("created_at", { ascending: false }),
    db
      .from("financial_incomes")
      .select(
        "id, created_by, cash_session_id, description, amount_cop, income_date, payment_method, notes, created_at",
      )
      .in("cash_session_id", ids)
      .order("created_at", { ascending: false }),
  ]);
  if (movementResult.error) throw movementResult.error;
  if (saleResult.error) throw saleResult.error;
  if (incomeResult.error) throw incomeResult.error;
  return {
    sessions: sessionRows,
    movements: (movementResult.data ?? []) as CashMovement[],
    sales: (saleResult.data ?? []) as CashSale[],
    incomes: (incomeResult.data ?? []) as FinancialIncome[],
  };
}

export async function fetchOpenCashSessions(
  userId: string,
  includeAll = false,
): Promise<CashSession[]> {
  let request = client()
    .from("cash_sessions")
    .select(
      "id, opened_by, status, opened_at, closed_at, opening_cop, expected_cop, counted_cop, difference_cop, sales_total_cop, sales_by_method, notes",
    )
    .eq("status", "open")
    .order("opened_at", { ascending: false });
  if (!includeAll) request = request.eq("opened_by", userId);
  const { data, error } = await request;
  if (error) throw error;
  return (data ?? []) as CashSession[];
}

export async function fetchFinancialPaymentMethods(): Promise<PaymentMethodOption[]> {
  const { data, error } = await client()
    .from("payment_method_settings")
    .select("method, label, enabled")
    .order("label");
  if (error) throw error;
  return (data ?? []) as PaymentMethodOption[];
}

export async function fetchExpenseData(): Promise<{
  categories: ExpenseCategory[];
  expenses: ExpenseRecord[];
}> {
  const db = client();
  const [categoriesResult, expensesResult] = await Promise.all([
    db.from("expense_categories").select("id, name, active").order("name"),
    db
      .from("expenses")
      .select(
        "id, created_by, category_id, description, amount_cop, expense_date, payment_method, cash_session_id, notes, created_at, expense_categories(id, name)",
      )
      .order("expense_date", { ascending: false })
      .limit(200),
  ]);
  if (categoriesResult.error) throw categoriesResult.error;
  if (expensesResult.error) throw expensesResult.error;
  return {
    categories: (categoriesResult.data ?? []) as ExpenseCategory[],
    expenses: (expensesResult.data ?? []) as unknown as ExpenseRecord[],
  };
}

export async function fetchFinancialReport(
  start: string,
  endExclusive: string,
): Promise<FinancialReport> {
  const { data, error } = await client().rpc("admin_financial_report", {
    p_start: start,
    p_end: endExclusive,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("Supabase no devolvió el resumen financiero.");
  }
  return row as FinancialReport;
}

export async function openFinancialCash(input: {
  opening_cop: number;
  notes: string;
}): Promise<void> {
  const { error } = await client().rpc("open_financial_cash_session", {
    p_opening_cop: input.opening_cop,
    p_notes: input.notes.trim() || null,
  });
  if (error) throw error;
}

export async function recordFinancialIncome(input: {
  description: string;
  amount_cop: number;
  income_date: string;
  payment_method: string;
  cash_session_id: string;
  notes: string;
}): Promise<void> {
  const { error } = await client().rpc("record_financial_income", {
    p_description: input.description.trim(),
    p_amount_cop: input.amount_cop,
    p_income_date: input.income_date,
    p_payment_method: input.payment_method,
    p_cash_session_id: input.cash_session_id,
    p_notes: input.notes.trim() || null,
  });
  if (error) throw error;
}

export async function recordCashWithdrawal(input: {
  cash_session_id: string;
  amount_cop: number;
  description: string;
  notes: string;
}): Promise<void> {
  const { error } = await client().rpc("record_cash_withdrawal", {
    p_cash_session_id: input.cash_session_id,
    p_amount_cop: input.amount_cop,
    p_description: input.description.trim(),
    p_notes: input.notes.trim() || null,
  });
  if (error) throw error;
}

export async function closeFinancialCash(input: {
  cash_session_id: string;
  counted_cop: number;
}): Promise<CashClosureResult> {
  const { data, error } = await client().rpc("close_financial_cash_session", {
    p_cash_session_id: input.cash_session_id,
    p_counted_cop: input.counted_cop,
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Supabase no confirmó el resumen de cierre.");
  }
  return data as CashClosureResult;
}

export async function recordFinancialExpense(input: {
  category_id: string;
  description: string;
  amount_cop: number;
  expense_date: string;
  payment_method: string;
  cash_session_id: string | null;
  notes: string;
}): Promise<void> {
  const { error } = await client().rpc("record_financial_expense", {
    p_category_id: input.category_id,
    p_description: input.description.trim(),
    p_amount_cop: input.amount_cop,
    p_expense_date: input.expense_date,
    p_payment_method: input.payment_method,
    p_cash_session_id: input.cash_session_id,
    p_notes: input.notes.trim() || null,
  });
  if (error) throw error;
}

export async function saveExpenseCategory(input: {
  id?: string;
  name: string;
  active: boolean;
  created_by: string;
}): Promise<void> {
  const db = client();
  const request = input.id
    ? db
        .from("expense_categories")
        .update({ name: input.name.trim(), active: input.active })
        .eq("id", input.id)
    : db
        .from("expense_categories")
        .insert({ name: input.name.trim(), active: true, created_by: input.created_by });
  const { error } = await request;
  if (error) throw error;
}
