-- Recipe roles and measured on-demand manufacturing security checks.
create extension if not exists pgtap with schema extensions;

begin;

select plan(10);

select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_save_recipe(uuid,uuid,integer,bigint,jsonb)',
    'EXECUTE'
  ),
  'authenticated sessions can call the admin-validated recipe editor'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.admin_save_recipe(uuid,uuid,integer,bigint,jsonb)',
    'EXECUTE'
  ),
  'anonymous callers cannot edit recipes'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.register_recipe_manufacture(uuid,integer,numeric,public.payment_method,uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated employees and administrators can request on-demand manufacture'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.register_recipe_manufacture(uuid,integer,numeric,public.payment_method,uuid,uuid,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot manufacture recipes'
);

select ok(
  not has_table_privilege(
    'authenticated', 'private.recipe_manufacturing_context', 'SELECT'
  ),
  'API users cannot read or forge the private manufacturing context'
);

select ok(
  exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'recipe_components'
       and policyname = 'recipe_components_select_active'
       and cmd = 'SELECT'
  ),
  'employees receive read-only RLS access to active recipe components'
);

select ok(
  exists (
    select 1 from pg_trigger
     where tgname = 'require_measured_recipe_manufacturing'
       and not tgisinternal
  ),
  'recipe sales with fill components require the measured manufacturing path'
);

select ok(
  exists (
    select 1 from pg_trigger
     where tgname = 'validate_active_recipe_bottle'
       and not tgisinternal
  ),
  'recipe activation requires a matching presentation bottle'
);

select ok(
  not has_column_privilege(
    'authenticated', 'public.materials', 'avg_unit_cost_cop', 'SELECT'
  ),
  'employee API cannot read current material costs'
);

select ok(
  not has_column_privilege(
    'authenticated', 'public.sales', 'total_cost_cop', 'SELECT'
  ),
  'employee API cannot read manufacturing cost or profit'
);

select * from finish();
rollback;
