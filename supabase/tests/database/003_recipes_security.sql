-- Recipe roles and measured on-demand manufacturing security checks.
create extension if not exists pgtap with schema extensions;

begin;

select plan(13);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '97000000-0000-4000-8000-000000000021',
    'authenticated',
    'authenticated',
    'recipe-test-employee@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '97000000-0000-4000-8000-000000000022',
    'authenticated',
    'authenticated',
    'recipe-test-admin@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  );

select private.begin_system_maintenance('pgtap recipe authorization verification');

insert into public.profiles (id, role, display_name)
values
  ('97000000-0000-4000-8000-000000000021', 'employee', 'Recipe test employee'),
  ('97000000-0000-4000-8000-000000000022', 'admin', 'Recipe test admin');

select private.end_system_maintenance();

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
    'public.register_pos_sale(jsonb,public.payment_method,uuid,bigint,uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated employees and administrators can request recipe manufacture through the POS RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.register_pos_sale(jsonb,public.payment_method,uuid,bigint,uuid,uuid,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot request recipe manufacture through the POS RPC'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.register_recipe_manufacture(uuid,integer,numeric,public.payment_method,uuid,uuid,text)',
    'EXECUTE'
  ),
  'the superseded standalone manufacturing RPC is not exposed to API users'
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

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000021',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000021","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.register_pos_sale(
      '[]'::jsonb, 'cash'::public.payment_method,
      '97000000-0000-4000-8000-000000000031'::uuid
    )$$,
  '22023',
  'Sale must contain between 1 and 100 lines',
  'an authenticated employee passes identity authorization and reaches sale validation'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000022',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000022","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.register_pos_sale(
      '[]'::jsonb, 'cash'::public.payment_method,
      '97000000-0000-4000-8000-000000000032'::uuid
    )$$,
  '22023',
  'Sale must contain between 1 and 100 lines',
  'an authenticated administrator passes identity authorization and reaches sale validation'
);
reset role;

select * from finish();
rollback;
