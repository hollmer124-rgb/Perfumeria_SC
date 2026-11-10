create extension if not exists pgtap with schema extensions;

begin;

select plan(19);

select ok(
  has_function_privilege(
    'authenticated',
    'public.open_financial_cash_session(bigint,text)',
    'EXECUTE'
  ),
  'authenticated users can open a cash session through the validated RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.open_financial_cash_session(bigint,text)',
    'EXECUTE'
  ),
  'anonymous users cannot open cash sessions'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.close_financial_cash_session(uuid,bigint)',
    'EXECUTE'
  ),
  'authenticated users close through the validated financial RPC'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.close_cash_session(uuid,bigint)',
    'EXECUTE'
  ),
  'the unsnapshotted legacy cash close RPC is not directly executable'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.close_financial_cash_session(uuid,bigint)',
    'EXECUTE'
  ),
  'anonymous users cannot close cash sessions'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.record_financial_income(text,bigint,date,public.payment_method,uuid,text)',
    'EXECUTE'
  ),
  'authenticated users can record other income through the validated RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.record_financial_income(text,bigint,date,public.payment_method,uuid,text)',
    'EXECUTE'
  ),
  'anonymous users cannot record income'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.record_cash_withdrawal(uuid,bigint,text,text)',
    'EXECUTE'
  ),
  'authenticated users can request a validated cash withdrawal'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.record_financial_expense(uuid,text,bigint,date,public.payment_method,uuid,text)',
    'EXECUTE'
  ),
  'authenticated callers reach the administrator-validated expense RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.record_financial_expense(uuid,text,bigint,date,public.payment_method,uuid,text)',
    'EXECUTE'
  ),
  'anonymous users cannot record expenses'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_financial_report(timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'authenticated callers reach the administrator-validated financial report'
);

select ok(
  not has_table_privilege('authenticated', 'public.financial_incomes', 'INSERT'),
  'financial income cannot be inserted outside its validated RPC'
);

select ok(
  not has_table_privilege('authenticated', 'public.financial_incomes', 'DELETE'),
  'financial income history cannot be deleted'
);

select ok(
  not has_table_privilege('authenticated', 'public.expenses', 'INSERT'),
  'expenses cannot be inserted outside the categorized RPC'
);

select ok(
  not has_table_privilege('authenticated', 'public.cash_movements', 'INSERT'),
  'cash movements cannot be inserted directly by clients'
);

select ok(
  not has_table_privilege('authenticated', 'public.expense_categories', 'DELETE'),
  'expense categories are deactivated instead of physically deleted'
);

select ok(
  (select relrowsecurity
     from pg_class
    where oid = 'public.financial_incomes'::regclass),
  'financial incomes have row-level security enabled'
);

select ok(
  exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.sales'::regclass
       and tgname = 'sales_require_cash_session'
       and not tgisinternal
  ),
  'all inserted sales are attached to an open cashier session'
);

select ok(
  exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'cash_sessions'
       and column_name = 'sales_by_method'
  )
  and exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'cash_sessions'
       and column_name = 'sales_total_cop'
  ),
  'cash close stores its sales totals by payment method'
);

select * from finish();
rollback;
