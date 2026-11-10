-- Run with `supabase test db`. This file verifies database grants and RLS,
-- not production business data.
create extension if not exists pgtap with schema extensions;

begin;

select plan(31);

select ok(
  (select count(*) = 18
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity),
  'RLS is enabled on all 18 application tables'
);

select ok(
  (select count(distinct tablename) = 18
     from pg_policies
    where schemaname = 'public'),
  'every application table has at least one policy'
);

select ok(
  not exists (
    select 1
      from unnest(array[
        'profiles', 'perfumes', 'retail_products', 'materials', 'recipes',
        'recipe_components', 'customers', 'suppliers', 'sales', 'sale_items',
        'sale_material_usage', 'purchases', 'purchase_items',
        'inventory_movements', 'expenses', 'cash_sessions', 'cash_movements',
        'audit_logs'
      ]) as t(table_name)
     where has_table_privilege(
       'anon', format('public.%I', t.table_name), 'SELECT'
     )
  ),
  'anonymous role has no application table read grants'
);

select ok(
  not has_column_privilege('authenticated', 'public.sales', 'total_cost_cop', 'SELECT'),
  'authenticated API cannot select sale costs'
);
select ok(
  not has_column_privilege('authenticated', 'public.sales', 'total_cost_cop', 'UPDATE'),
  'authenticated API cannot update sale costs'
);
select ok(
  not has_column_privilege('authenticated', 'public.sale_items', 'unit_cost_cop', 'SELECT'),
  'authenticated API cannot select sale item unit costs'
);
select ok(
  not has_column_privilege('authenticated', 'public.sale_items', 'line_cost_cop', 'SELECT'),
  'authenticated API cannot select sale item total costs'
);
select ok(
  not has_column_privilege('authenticated', 'public.sale_items', 'recipe_snapshot', 'SELECT'),
  'authenticated API cannot read cost-bearing recipe snapshots'
);
select ok(
  not has_column_privilege('authenticated', 'public.retail_products', 'avg_unit_cost_cop', 'SELECT'),
  'authenticated API cannot select retail product costs'
);
select ok(
  not has_column_privilege('authenticated', 'public.materials', 'on_hand_qty', 'UPDATE'),
  'authenticated API cannot change material inventory directly'
);
select ok(
  not has_column_privilege('authenticated', 'public.materials', 'avg_unit_cost_cop', 'UPDATE'),
  'authenticated API cannot change material average costs directly'
);
select ok(
  has_column_privilege('authenticated', 'public.materials', 'on_hand_qty', 'SELECT'),
  'authenticated employees can consult operational material stock'
);
select ok(
  not has_column_privilege('authenticated', 'public.materials', 'avg_unit_cost_cop', 'SELECT'),
  'authenticated employees cannot read material costs'
);
select ok(
  exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'materials'
       and policyname = 'materials_employee_inventory_select'
  ),
  'employee stock visibility is limited by an active-material RLS policy'
);
select ok(
  not has_table_privilege('authenticated', 'public.sales', 'INSERT'),
  'sales can only be created through the transactional function'
);
select ok(
  not has_table_privilege('authenticated', 'public.sale_items', 'INSERT'),
  'sale items can only be created through the transactional function'
);
select ok(
  not has_table_privilege('authenticated', 'public.inventory_movements', 'INSERT'),
  'inventory movements cannot be forged through the Data API'
);
select ok(
  not has_table_privilege('authenticated', 'public.cash_movements', 'INSERT'),
  'cash movements can only be created transactionally'
);
select ok(
  not has_table_privilege('authenticated', 'public.expenses', 'INSERT'),
  'expenses can only be recorded through the validated function'
);
select ok(
  not has_table_privilege('authenticated', 'public.audit_logs', 'INSERT'),
  'audit log is append-only through trusted triggers'
);
select ok(
  not has_schema_privilege('anon', 'private', 'USAGE'),
  'private authorization helpers are not exposed to anon'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.register_sale(jsonb,public.payment_method,uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated role can call the validated sale function'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.register_sale(jsonb,public.payment_method,uuid,uuid,text)',
    'EXECUTE'
  ),
  'anonymous role cannot call the sale function'
);
select ok(
  not has_function_privilege(
    'anon', 'public.admin_sale_costs(uuid)', 'EXECUTE'
  ),
  'anonymous role cannot call the admin cost function'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.admin_sale_costs(uuid)', 'EXECUTE'
  ),
  'admin-only cost function is callable only with internal role validation'
);
select ok(
  not has_function_privilege(
    'anon', 'public.receive_purchase(uuid)', 'EXECUTE'
  ),
  'anonymous role cannot receive purchases'
);
select ok(
  not has_function_privilege(
    'anon', 'public.adjust_inventory(uuid,uuid,numeric,text,bigint)', 'EXECUTE'
  ),
  'anonymous role cannot adjust inventory'
);

select ok(
  (select count(*) = 2
     from pg_enum e
     join pg_type t on t.oid = e.enumtypid
     join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'app_role'
      and e.enumlabel in ('admin', 'employee')),
  'only admin and employee application roles are defined'
);
select ok(
  (select count(*) = 4
     from pg_enum e
     join pg_type t on t.oid = e.enumtypid
     join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'material_unit'
      and e.enumlabel in ('g', 'ml', 'unit', 'dose')),
  'all four configured material units exist'
);
select ok(
  to_regclass('public.recipe_components_one_fill_idx') is not null,
  'a recipe can have at most one fill_to_volume component'
);
select ok(
  to_regclass('public.recipes_one_active_version_idx') is not null,
  'a perfume presentation can have at most one active recipe version'
);

select * from finish();
rollback;
