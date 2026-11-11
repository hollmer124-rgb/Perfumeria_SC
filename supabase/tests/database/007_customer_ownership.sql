create extension if not exists pgtap with schema extensions;

begin;

select plan(15);

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
    '97000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'customer-owner@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '97000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'customer-other@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '97000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'customer-admin@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  );

select private.begin_system_maintenance('pgtap customer ownership verification');

insert into public.profiles (id, role, display_name)
values
  ('97000000-0000-4000-8000-000000000001', 'employee', 'Ownership test employee'),
  ('97000000-0000-4000-8000-000000000002', 'employee', 'Other test employee'),
  ('97000000-0000-4000-8000-000000000003', 'admin', 'Ownership test admin');

insert into public.customers (id, full_name, created_by)
values
  (
    '97000000-0000-4000-8000-000000000011',
    'Ownership test customer',
    '97000000-0000-4000-8000-000000000001'
  ),
  (
    '97000000-0000-4000-8000-000000000012',
    'Other employee customer',
    '97000000-0000-4000-8000-000000000002'
  );

select private.end_system_maintenance();

select ok(
  (select relrowsecurity
     from pg_class
    where oid = 'public.customers'::regclass),
  'customer rows remain protected by RLS'
);

select ok(
  has_table_privilege('authenticated', 'public.customers', 'UPDATE'),
  'authenticated clients reach the ownership-checked update policy'
);

select ok(
  (select count(*) = 1
     from pg_policies
    where schemaname = 'public'
      and tablename = 'customers'
      and cmd = 'UPDATE'
      and policyname = 'customers_update_own_or_admin')
    and (select count(*) = 1
           from pg_policies
          where schemaname = 'public'
            and tablename = 'customers'
            and cmd = 'UPDATE'),
  'only the intended customer UPDATE policy remains active'
);

select ok(
  exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'customers'
       and policyname = 'customers_update_own_or_admin'
       and cmd = 'UPDATE'
       and qual like '%created_by%'
       and qual like '%auth.uid%'
       and qual like '%is_admin%'
       and with_check like '%created_by%'
       and with_check like '%auth.uid%'
       and with_check like '%is_admin%'
       and not exists (
         select 1
           from pg_policies old_policy
          where old_policy.schemaname = 'public'
            and old_policy.tablename = 'customers'
            and old_policy.cmd = 'UPDATE'
            and old_policy.policyname in (
              'customers_update_authenticated',
              'customers_update_admin_or_owner'
            )
       )
  ),
  'customer updates check ownership and administrator status in USING and WITH CHECK'
);

select ok(
  not has_table_privilege('anon', 'public.customers', 'UPDATE'),
  'anonymous clients cannot update customer records'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
insert into public.customers (id, full_name, created_by)
values (
  '97000000-0000-4000-8000-000000000013',
  'New owner customer',
  '97000000-0000-4000-8000-000000000001'
);
reset role;

select is(
  (select created_by::text from public.customers
    where id = '97000000-0000-4000-8000-000000000013'),
  '97000000-0000-4000-8000-000000000001',
  'an employee can create a customer assigned to their own identity'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$insert into public.customers (id, full_name, created_by)
    values (
      '97000000-0000-4000-8000-000000000014',
      'Forged owner customer',
      '97000000-0000-4000-8000-000000000002'
    )$$,
  '42501',
  'new row violates row-level security policy for table "customers"',
  'an employee cannot create a customer assigned to another identity'
);
reset role;

select is(
  (select count(*)::integer from public.customers
    where id = '97000000-0000-4000-8000-000000000014'),
  0,
  'a rejected customer insert leaves no forged-owner record'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
update public.customers
   set full_name = 'Owner update succeeded'
 where id = '97000000-0000-4000-8000-000000000011';
reset role;

select is(
  (select full_name from public.customers
    where id = '97000000-0000-4000-8000-000000000011'),
  'Owner update succeeded',
  'an employee can update a customer they created'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
update public.customers
   set full_name = 'Unauthorized update succeeded'
 where id = '97000000-0000-4000-8000-000000000012';
reset role;

select is(
  (select full_name from public.customers
    where id = '97000000-0000-4000-8000-000000000012'),
  'Other employee customer',
  'an employee cannot update a customer created by someone else'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$update public.customers
       set created_by = '97000000-0000-4000-8000-000000000002'
     where id = '97000000-0000-4000-8000-000000000011'$$,
  '42501',
  'new row violates row-level security policy for table "customers"',
  'an employee cannot transfer ownership by changing created_by'
);
reset role;

select is(
  (select created_by::text from public.customers
    where id = '97000000-0000-4000-8000-000000000011'),
  '97000000-0000-4000-8000-000000000001',
  'a rejected ownership change leaves the customer owner unchanged'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select throws_ok(
  $$update public.customers
       set full_name = 'Anonymous update succeeded'
     where id = '97000000-0000-4000-8000-000000000011'$$,
  '42501',
  'permission denied for table customers',
  'an unauthenticated user cannot update customers'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000003',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000003","role":"authenticated"}',
  true
);
update public.customers
   set full_name = 'Administrator update succeeded',
       created_by = '97000000-0000-4000-8000-000000000003'
 where id = '97000000-0000-4000-8000-000000000011';
reset role;

select is(
  (select full_name from public.customers
    where id = '97000000-0000-4000-8000-000000000011'),
  'Administrator update succeeded',
  'an administrator can update a customer created by an employee'
);

select is(
  (select created_by::text from public.customers
    where id = '97000000-0000-4000-8000-000000000011'),
  '97000000-0000-4000-8000-000000000003',
  'an administrator retains the ability to change customer ownership'
);

select * from finish();
rollback;
