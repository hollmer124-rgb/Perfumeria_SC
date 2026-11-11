create extension if not exists pgtap with schema extensions;

begin;

select plan(15);

select ok(
  has_function_privilege(
    'authenticated',
    'public.dashboard_metrics(timestamptz,timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'authenticated employees and admins can request role-scoped dashboard metrics'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.dashboard_metrics(timestamptz,timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'anonymous clients cannot request dashboard data'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_operational_report(timestamptz,timestamptz,text,uuid,text,uuid,timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'authenticated clients reach the administrator-validated report RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.admin_operational_report(timestamptz,timestamptz,text,uuid,text,uuid,timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'anonymous clients cannot execute operational reports'
);

select ok(
  (select prosecdef
     from pg_proc
    where oid = 'public.dashboard_metrics(timestamptz,timestamptz,timestamptz)'::regprocedure),
  'dashboard metrics are aggregated inside PostgreSQL'
);

select ok(
  (select prosecdef
     from pg_proc
    where oid = 'public.admin_operational_report(timestamptz,timestamptz,text,uuid,text,uuid,timestamptz,timestamptz)'::regprocedure),
  'reports are aggregated inside the administrator-validated PostgreSQL function'
);

select ok(
  (select exists (
      select 1
        from unnest(proconfig) as setting
       where setting like 'search_path=%'
    )
     from pg_proc
    where oid = 'public.dashboard_metrics(timestamptz,timestamptz,timestamptz)'::regprocedure),
  'dashboard function pins its search path'
);

select ok(
  (select exists (
      select 1
        from unnest(proconfig) as setting
       where setting like 'search_path=%'
    )
     from pg_proc
    where oid = 'public.admin_operational_report(timestamptz,timestamptz,text,uuid,text,uuid,timestamptz,timestamptz)'::regprocedure),
  'report function pins its search path'
);

select ok(
  pg_get_functiondef(
    'public.dashboard_metrics(timestamptz,timestamptz,timestamptz)'::regprocedure
  ) like '%auth.uid()%'
  and pg_get_functiondef(
    'public.dashboard_metrics(timestamptz,timestamptz,timestamptz)'::regprocedure
  ) like '%private.is_employee_or_admin()%',
  'dashboard verifies an authenticated employee or administrator inside PostgreSQL'
);

select ok(
  pg_get_functiondef(
    'public.admin_operational_report(timestamptz,timestamptz,text,uuid,text,uuid,timestamptz,timestamptz)'::regprocedure
  ) like '%private.current_role() is distinct from%',
  'the report RPC validates the administrator role inside PostgreSQL'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.dashboard_metrics_before_filter_correction(timestamptz,timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'the uncorrected dashboard implementation is not exposed as an API RPC'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.admin_operational_report_before_filter_correction(timestamptz,timestamptz,text,uuid,text,uuid,timestamptz,timestamptz)',
    'EXECUTE'
  ),
  'the uncorrected report implementation is not exposed as an API RPC'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.net_sale_line_amount(bigint,bigint,bigint,bigint,text,bigint)',
    'EXECUTE'
  ),
  'the report calculation helper is not directly executable by API users'
);

select is(
  private.net_sale_line_amount(1000, 100, 2000, 1900, null, null),
  950::bigint,
  'line totals distribute the sale discount'
);

select is(
  private.net_sale_line_amount(1000, 100, 2000, 1900, 'refund', 950),
  475::bigint,
  'line totals attribute refunds proportionally after discount'
);

select * from finish();
rollback;
