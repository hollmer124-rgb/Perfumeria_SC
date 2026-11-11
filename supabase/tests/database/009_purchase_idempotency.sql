create extension if not exists pgtap with schema extensions;

begin;

select plan(16);

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
    '97000000-0000-4000-8000-000000000061',
    'authenticated',
    'authenticated',
    'purchase-idempotency-employee@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '97000000-0000-4000-8000-000000000062',
    'authenticated',
    'authenticated',
    'purchase-idempotency-admin@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '97000000-0000-4000-8000-000000000063',
    'authenticated',
    'authenticated',
    'purchase-idempotency-second-admin@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  );

select private.begin_system_maintenance(
  'pgtap purchase idempotency fixture setup'
);

insert into public.profiles (id, role, display_name)
values
  ('97000000-0000-4000-8000-000000000061', 'employee', 'Purchase test employee'),
  ('97000000-0000-4000-8000-000000000062', 'admin', 'Purchase test administrator'),
  ('97000000-0000-4000-8000-000000000063', 'admin', 'Purchase test second administrator');

select private.end_system_maintenance();

create temporary table purchase_idempotency_refs (
  ref text primary key,
  id uuid not null
);
grant select, insert on purchase_idempotency_refs to authenticated;

create function private.pgtap_fail_purchase_item()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.pgtap_failure_mode', true) = 'purchase_create' then
    raise exception 'forced purchase item creation failure' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger pgtap_fail_purchase_item
before insert on public.purchase_items
for each row execute function private.pgtap_fail_purchase_item();

select ok(
  not has_function_privilege(
    'anon',
    'public.create_purchase(uuid,date,jsonb,text,uuid)',
    'EXECUTE'
  ),
  'anon cannot execute the idempotent purchase RPC'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_purchase(uuid,date,jsonb,text,uuid)',
    'EXECUTE'
  ),
  'authenticated has execute only on the current purchase RPC'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000061',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000061","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.create_purchase(
      '91000000-0000-4000-8000-000000000002',
      current_date,
      '[{"type":"material","id":"94000000-0000-4000-8000-000000000001","quantity":1,"unit_cost_cop":1}]'::jsonb,
      null,
      '97000000-0000-4000-8000-000000000064'::uuid
    )$$,
  '42501',
  'Only an authenticated administrator can create purchases',
  'an authenticated employee cannot create a purchase'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000062',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000062","role":"authenticated"}',
  true
);

insert into pg_temp.purchase_idempotency_refs (ref, id)
select 'first',
  public.create_purchase(
    '91000000-0000-4000-8000-000000000002',
    current_date,
    '[{"type":"material","id":"94000000-0000-4000-8000-000000000001","quantity":1,"unit_cost_cop":100},{"type":"retail_product","id":"93000000-0000-4000-8000-000000000001","quantity":1,"unit_cost_cop":200}]'::jsonb,
    ' canonical request ',
    '97000000-0000-4000-8000-000000000065'::uuid
  );

insert into pg_temp.purchase_idempotency_refs (ref, id)
select 'retry',
  public.create_purchase(
    '91000000-0000-4000-8000-000000000002',
    current_date,
    '[{"type":"retail_product","id":"93000000-0000-4000-8000-000000000001","quantity":1.0000,"unit_cost_cop":200},{"type":"material","id":"94000000-0000-4000-8000-000000000001","quantity":1.0000,"unit_cost_cop":100}]'::jsonb,
    'canonical request',
    '97000000-0000-4000-8000-000000000065'::uuid
  );
reset role;

select is(
  (select id from pg_temp.purchase_idempotency_refs where ref = 'retry'),
  (select id from pg_temp.purchase_idempotency_refs where ref = 'first'),
  'an identical canonical retry returns the original purchase'
);

select is(
  (select count(*) from public.purchases
    where created_by = '97000000-0000-4000-8000-000000000062'),
  1::bigint,
  'an identical retry creates no duplicate purchase header'
);

select is(
  (select count(*) from public.purchase_items
    where purchase_id = (select id from pg_temp.purchase_idempotency_refs where ref = 'first')),
  2::bigint,
  'an identical retry creates no duplicate purchase items'
);

select is(
  (select count(*) from private.purchase_idempotency
    where actor_id = '97000000-0000-4000-8000-000000000062'
      and idempotency_key = '97000000-0000-4000-8000-000000000065'),
  1::bigint,
  'one private idempotency result is stored for the user and key'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000062',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000062","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.create_purchase(
      '91000000-0000-4000-8000-000000000002',
      current_date,
      '[{"type":"material","id":"94000000-0000-4000-8000-000000000001","quantity":2,"unit_cost_cop":100}]'::jsonb,
      'canonical request',
      '97000000-0000-4000-8000-000000000065'::uuid
    )$$,
  '23505',
  'Idempotency key was already used for a different request',
  'reusing a key with changed content is explicitly rejected'
);
insert into pg_temp.purchase_idempotency_refs (ref, id)
select 'different_key',
  public.create_purchase(
    '91000000-0000-4000-8000-000000000002',
    current_date,
    '[{"type":"material","id":"94000000-0000-4000-8000-000000000001","quantity":1,"unit_cost_cop":100}]'::jsonb,
    'canonical request',
    '97000000-0000-4000-8000-000000000066'::uuid
  );
reset role;

select isnt(
  (select id from pg_temp.purchase_idempotency_refs where ref = 'different_key'),
  (select id from pg_temp.purchase_idempotency_refs where ref = 'first'),
  'a different key creates an independent purchase'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000063',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000063","role":"authenticated"}',
  true
);
insert into pg_temp.purchase_idempotency_refs (ref, id)
select 'different_user',
  public.create_purchase(
    '91000000-0000-4000-8000-000000000002',
    current_date,
    '[{"type":"material","id":"94000000-0000-4000-8000-000000000001","quantity":1,"unit_cost_cop":100},{"type":"retail_product","id":"93000000-0000-4000-8000-000000000001","quantity":1,"unit_cost_cop":200}]'::jsonb,
    'canonical request',
    '97000000-0000-4000-8000-000000000065'::uuid
  );
reset role;

select isnt(
  (select id from pg_temp.purchase_idempotency_refs where ref = 'different_user'),
  (select id from pg_temp.purchase_idempotency_refs where ref = 'first'),
  'the same key is scoped independently to a different administrator'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000062',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000062","role":"authenticated"}',
  true
);
select set_config('app.pgtap_failure_mode', 'purchase_create', true);
select throws_ok(
  $$select public.create_purchase(
      '91000000-0000-4000-8000-000000000002',
      current_date,
      '[{"type":"material","id":"94000000-0000-4000-8000-000000000001","quantity":1,"unit_cost_cop":100}]'::jsonb,
      'forced atomic failure',
      '97000000-0000-4000-8000-000000000067'::uuid
    )$$,
  'P0001',
  'forced purchase item creation failure',
  'a mid-operation failure is surfaced'
);
select set_config('app.pgtap_failure_mode', '', true);
reset role;

select is(
  (select count(*) from public.purchases),
  3::bigint,
  'a failed request leaves no partial purchase header'
);

select is(
  (select count(*) from public.purchase_items),
  5::bigint,
  'a failed request leaves no partial purchase items'
);

select is(
  (select count(*) from private.purchase_idempotency
    where actor_id = '97000000-0000-4000-8000-000000000062'
      and idempotency_key = '97000000-0000-4000-8000-000000000067'),
  0::bigint,
  'a failed request leaves no idempotency row or blocked key'
);

select is(
  (select count(*) from public.audit_logs
    where table_name = 'purchases'
      and action = 'INSERT'
      and actor_id = '97000000-0000-4000-8000-000000000062'),
  2::bigint,
  'a failed request leaves no partial purchase audit record'
);

select is(
  (select count(*) from public.audit_logs
    where table_name = 'purchase_items'
      and action = 'INSERT'),
  5::bigint,
  'purchase item audit records match only committed test purchases'
);

select * from finish();

rollback;
