create extension if not exists pgtap with schema extensions;

begin;

select plan(17);

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
    '98000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'settings-employee@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '98000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'settings-admin@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  );

select private.begin_system_maintenance('pgtap business settings verification');

insert into public.profiles (id, role, display_name)
values
  ('98000000-0000-4000-8000-000000000001', 'employee', 'Settings test employee'),
  ('98000000-0000-4000-8000-000000000002', 'admin', 'Settings test admin');

select private.end_system_maintenance();

select is(
  (select count(*)::integer from public.business_settings),
  1,
  'the migration initializes exactly one business settings record'
);

select ok(
  exists (
    select 1
      from pg_constraint
     where conrelid = 'public.business_settings'::regclass
       and contype = 'p'
  )
    and exists (
      select 1
        from pg_constraint
       where conrelid = 'public.business_settings'::regclass
         and contype = 'c'
         and pg_get_constraintdef(oid) like '%id = 1%'
    ),
  'the primary key and singleton check prevent duplicate settings records'
);

select ok(
  (select relrowsecurity
     from pg_class
    where oid = 'public.business_settings'::regclass),
  'business settings use row-level security'
);

select is(
  (select count(*)::integer
     from pg_policies
    where schemaname = 'public'
      and tablename = 'business_settings'),
  2,
  'business settings have only the authenticated read and administrator update policies'
);

select ok(
  has_column_privilege(
    'authenticated', 'public.business_settings', 'business_name', 'SELECT'
  ),
  'authenticated users can read business contact information'
);

select ok(
  has_column_privilege(
    'authenticated', 'public.business_settings', 'business_name', 'UPDATE'
  ),
  'authenticated users reach the administrator-only update policy'
);

select ok(
  not has_table_privilege('anon', 'public.business_settings', 'SELECT')
    and not has_table_privilege('anon', 'public.business_settings', 'UPDATE'),
  'anonymous users have no access to business settings'
);

select ok(
  not has_table_privilege('authenticated', 'public.business_settings', 'INSERT')
    and not has_table_privilege('authenticated', 'public.business_settings', 'DELETE'),
  'authenticated users cannot create or delete the singleton settings record'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
select throws_ok(
  $$select business_name from public.business_settings where id = 1$$,
  '42501',
  'permission denied for table business_settings',
  'anonymous users cannot read business settings'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '98000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select throws_ok(
  $$insert into public.business_settings (id, business_name)
    values (1, 'Unauthorized insert')$$,
  '42501',
  'permission denied for table business_settings',
  'an employee cannot insert a business settings record'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '98000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select set_config(
  'test.business_name',
  coalesce(
    (select business_name from public.business_settings where id = 1),
    ''
  ),
  true
);
update public.business_settings
   set business_name = 'Employee must not change this'
 where id = 1;
reset role;

select is(
  current_setting('test.business_name', true),
  'Perfumeria SC',
  'an employee can read the business settings'
);

select is(
  (select business_name from public.business_settings where id = 1),
  'Perfumeria SC',
  'employees can read settings but cannot update them'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '98000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"98000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
update public.profiles
   set display_name = 'Updated settings employee',
       phone = '555-0101'
 where id = '98000000-0000-4000-8000-000000000001';
reset role;

select is(
  (select display_name || ':' || phone
     from public.profiles
    where id = '98000000-0000-4000-8000-000000000001'),
  'Updated settings employee:555-0101',
  'a user can update their own editable profile fields'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '98000000-0000-4000-8000-000000000002',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"98000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
select set_config(
  'test.admin_business_name',
  coalesce(
    (select business_name from public.business_settings where id = 1),
    ''
  ),
  true
);
reset role;

select is(
  current_setting('test.admin_business_name', true),
  'Perfumeria SC',
  'an administrator can read business settings'
);

select ok(
  not has_column_privilege(
    'authenticated', 'public.profiles', 'role', 'UPDATE'
  ),
  'authenticated users cannot change a profile role through the Data API'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '98000000-0000-4000-8000-000000000002',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"98000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
update public.business_settings
   set business_name = 'Settings test updated'
 where id = 1;
reset role;

select is(
  (select business_name from public.business_settings where id = 1),
  'Settings test updated',
  'an administrator can update the business settings'
);

select ok(
  exists (
    select 1
      from public.audit_logs
     where actor_id = '98000000-0000-4000-8000-000000000002'
       and table_name = 'business_settings'
       and record_id = '1'
       and action = 'UPDATE'
  ),
  'business settings updates retain the existing audit trail'
);

select * from finish();
rollback;
