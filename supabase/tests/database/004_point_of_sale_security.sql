-- POS tables are writeable only through permission-checked RPCs.
create extension if not exists pgtap with schema extensions;

begin;

select plan(19);

select ok(
  has_function_privilege(
    'authenticated',
    'public.register_pos_sale(jsonb,public.payment_method,uuid,bigint,uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated clients can request a sale through the validated POS RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.register_pos_sale(jsonb,public.payment_method,uuid,bigint,uuid,uuid,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot register sales'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.register_sale(jsonb,public.payment_method,uuid,uuid,text)',
    'EXECUTE'
  ),
  'the non-idempotent legacy sales RPC is unavailable'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_reverse_sale(uuid,text,text,boolean,public.payment_method,uuid)',
    'EXECUTE'
  ),
  'authenticated callers reach the administrator-validated reversal RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.admin_reverse_sale(uuid,text,text,boolean,public.payment_method,uuid)',
    'EXECUTE'
  ),
  'anonymous callers cannot reverse sales'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_configure_payment_method(public.payment_method,text,boolean)',
    'EXECUTE'
  ),
  'authenticated callers reach the administrator-validated payment settings RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.admin_configure_payment_method(public.payment_method,text,boolean)',
    'EXECUTE'
  ),
  'anonymous callers cannot configure payment methods'
);

select ok(
  not has_table_privilege('authenticated', 'public.sales', 'INSERT'),
  'sales cannot be inserted outside a transactional RPC'
);

select ok(
  not has_table_privilege('authenticated', 'public.sale_items', 'INSERT'),
  'sale items cannot be inserted outside a transactional RPC'
);

select ok(
  not has_table_privilege('authenticated', 'public.sales', 'DELETE'),
  'completed sale headers cannot be physically deleted'
);

select ok(
  not has_table_privilege('authenticated', 'public.sale_items', 'DELETE'),
  'sale history lines cannot be physically deleted'
);

select ok(
  not has_table_privilege('authenticated', 'public.sale_adjustments', 'INSERT'),
  'sale reversals cannot bypass the administrator-validated RPC'
);

select ok(
  not has_table_privilege('authenticated', 'public.payment_method_settings', 'UPDATE'),
  'payment settings can only be changed through the validated RPC'
);

select ok(
  (select relrowsecurity
     from pg_class
    where oid = 'public.payment_method_settings'::regclass),
  'payment method settings have row-level security enabled'
);

select ok(
  (select relrowsecurity
     from pg_class
    where oid = 'public.sale_adjustments'::regclass),
  'sale adjustments have row-level security enabled'
);

select ok(
  exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'sale_adjustments'
       and policyname = 'sale_adjustments_select_own'
       and cmd = 'SELECT'
  ),
  'employees can read adjustments only through their own sales'
);

select ok(
  exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and tablename = 'sales'
       and indexname = 'sales_idempotency_key_idx'
       and indexdef ilike '%UNIQUE%'
  ),
  'the idempotency key is unique'
);

select ok(
  exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'sales'
       and column_name = 'request_fingerprint'
  ),
  'sale requests persist their idempotency fingerprint'
);

select ok(
  exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'cash_movements'
       and column_name = 'sale_adjustment_id'
  ),
  'cash refunds are traceable to their sale adjustment'
);

select * from finish();
rollback;
