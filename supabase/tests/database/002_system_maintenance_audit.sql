-- Verify the private maintenance capability using the local trusted test role.
-- All fixture writes are rolled back at the end of the test.
create extension if not exists pgtap with schema extensions;

begin;

select plan(15);

select ok(
  exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'audit_logs'
       and column_name = 'actor_type'
       and is_nullable = 'NO'
  ),
  'audit log records a non-null actor type'
);

select ok(
  exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'audit_logs'
       and column_name = 'system_reason'
  ),
  'audit log has a system maintenance reason column'
);

select ok(
  not has_function_privilege(
    'anon', 'private.begin_system_maintenance(text)', 'EXECUTE'
  ),
  'anon cannot start system maintenance'
);

select ok(
  not has_function_privilege(
    'authenticated', 'private.begin_system_maintenance(text)', 'EXECUTE'
  ),
  'authenticated cannot start system maintenance'
);

select ok(
  not has_function_privilege(
    'anon', 'private.end_system_maintenance()', 'EXECUTE'
  ),
  'anon cannot end system maintenance'
);

select ok(
  not has_function_privilege(
    'authenticated', 'private.end_system_maintenance()', 'EXECUTE'
  ),
  'authenticated cannot end system maintenance'
);

select ok(
  not has_function_privilege(
    'anon', 'private.system_maintenance_context_valid()', 'EXECUTE'
  ),
  'anon cannot inspect maintenance authorization'
);

select ok(
  not has_function_privilege(
    'authenticated', 'private.system_maintenance_context_valid()', 'EXECUTE'
  ),
  'authenticated cannot inspect maintenance authorization'
);

select ok(
  not has_table_privilege(
    'authenticated', 'private.system_maintenance_context', 'SELECT'
  ),
  'authenticated cannot read system maintenance context'
);

select lives_ok(
  $$select private.begin_system_maintenance('pgtap system audit verification')$$,
  'trusted local database role can establish explicit maintenance context'
);

select ok(
  private.system_maintenance_context_valid(),
  'maintenance context is bound to this backend and transaction'
);

insert into public.perfumes (id, name, brand, description, active)
values (
  '97000000-0000-4000-8000-000000000001',
  'DEMO - Audit verification',
  'DEMO - Test only',
  'Temporary pgtap fixture; rolled back.',
  true
);

select is(
  (
    select al.actor_type
      from public.audit_logs al
     where al.table_name = 'perfumes'
       and al.record_id = '97000000-0000-4000-8000-000000000001'
       and al.action = 'INSERT'
  ),
  'system',
  'audited maintenance insert is recorded as a system actor'
);

select is(
  (
    select al.system_reason
      from public.audit_logs al
     where al.table_name = 'perfumes'
       and al.record_id = '97000000-0000-4000-8000-000000000001'
       and al.action = 'INSERT'
  ),
  'pgtap system audit verification',
  'audit event stores the explicit maintenance reason'
);

select lives_ok(
  $$select private.end_system_maintenance()$$,
  'trusted database role can close the maintenance context'
);

select ok(
  not private.system_maintenance_context_valid(),
  'maintenance context is invalid after it is closed'
);

select * from finish();
rollback;
