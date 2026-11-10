-- Permit explicit, transaction-scoped auditing for trusted database maintenance.
-- This does not bypass RLS, disable triggers, or grant access to API roles.

alter table public.audit_logs
  add column actor_type text not null default 'user',
  add column system_reason text,
  add constraint audit_logs_actor_type_check
    check (
      (actor_type = 'user' and system_reason is null)
      or (
        actor_type = 'system'
        and actor_id is null
        and system_reason is not null
        and length(btrim(system_reason)) between 1 and 160
      )
    );

create table private.system_maintenance_context (
  backend_pid integer primary key,
  transaction_id bigint not null,
  session_user_name name not null,
  context_token uuid not null,
  reason text not null
    check (length(btrim(reason)) between 1 and 160),
  started_at timestamptz not null default clock_timestamp()
);

revoke all on table private.system_maintenance_context
  from public, anon, authenticated;

create or replace function private.is_privileged_maintenance_connection()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_effective_role text := nullif(current_setting('role', true), 'none');
begin
  if session_user in ('postgres', 'supabase_admin') then
    return true;
  end if;
  if exists (
    select 1
      from pg_catalog.pg_roles r
     where r.rolname = session_user
       and r.rolsuper
  ) then
    return true;
  end if;
  if v_effective_role in ('postgres', 'supabase_admin') then
    return pg_catalog.pg_has_role(session_user, v_effective_role, 'member');
  end if;
  return false;
end;
$$;

create or replace function private.begin_system_maintenance(p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid;
  v_pid integer := pg_catalog.pg_backend_pid();
begin
  if not private.is_privileged_maintenance_connection()
     or auth.uid() is not null
     or current_setting('session_replication_role', true)
          is distinct from 'origin' then
    raise exception 'Privileged database maintenance connection required'
      using errcode = '42501';
  end if;

  if p_reason is null or length(btrim(p_reason)) not between 1 and 160 then
    raise exception 'A system maintenance reason of 1 to 160 characters is required'
      using errcode = '22023';
  end if;

  v_token := pg_catalog.gen_random_uuid();

  delete from private.system_maintenance_context
   where backend_pid = v_pid
      or not exists (
        select 1
          from pg_catalog.pg_stat_activity a
         where a.pid = system_maintenance_context.backend_pid
      );

  insert into private.system_maintenance_context (
    backend_pid, transaction_id, session_user_name, context_token, reason
  )
  values (
    v_pid, pg_catalog.txid_current(), session_user, v_token, btrim(p_reason)
  );

  perform pg_catalog.set_config(
    'app.system_maintenance_token', v_token::text, true
  );
  perform pg_catalog.set_config(
    'app.system_maintenance_reason', btrim(p_reason), true
  );
end;
$$;

create or replace function private.system_maintenance_context_valid()
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select
    auth.uid() is null
    and private.is_privileged_maintenance_connection()
    and exists (
      select 1
        from private.system_maintenance_context c
       where c.backend_pid = pg_catalog.pg_backend_pid()
         and c.transaction_id = pg_catalog.txid_current()
         and c.session_user_name = session_user
         and c.context_token::text = current_setting(
           'app.system_maintenance_token', true
         )
         and c.reason = current_setting('app.system_maintenance_reason', true)
    );
$$;

create or replace function private.end_system_maintenance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.system_maintenance_context_valid() then
    raise exception 'A valid system maintenance context is required'
      using errcode = '42501';
  end if;

  delete from private.system_maintenance_context
   where backend_pid = pg_catalog.pg_backend_pid()
     and transaction_id = pg_catalog.txid_current();

  perform pg_catalog.set_config('app.system_maintenance_token', '', true);
  perform pg_catalog.set_config('app.system_maintenance_reason', '', true);
end;
$$;

revoke all on function private.is_privileged_maintenance_connection()
  from public, anon, authenticated;
revoke all on function private.begin_system_maintenance(text)
  from public, anon, authenticated;
revoke all on function private.system_maintenance_context_valid()
  from public, anon, authenticated;
revoke all on function private.end_system_maintenance()
  from public, anon, authenticated;
grant execute on function private.begin_system_maintenance(text)
  to postgres, supabase_admin;
grant execute on function private.end_system_maintenance()
  to postgres, supabase_admin;
do $$
declare
  v_role name;
begin
  for v_role in
    select r.rolname
      from pg_catalog.pg_roles r
     where r.rolsuper
       and r.rolname not in ('postgres', 'supabase_admin')
  loop
    execute pg_catalog.format(
      'grant execute on function private.begin_system_maintenance(text) to %I',
      v_role
    );
    execute pg_catalog.format(
      'grant execute on function private.end_system_maintenance() to %I',
      v_role
    );
  end loop;
end;
$$;

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_type text := 'user';
  v_system_reason text;
  v_role public.app_role;
  v_old jsonb;
  v_new jsonb;
  v_record jsonb;
begin
  if v_actor is null then
    if private.system_maintenance_context_valid() then
      v_actor_type := 'system';
      select c.reason
        into strict v_system_reason
        from private.system_maintenance_context c
       where c.backend_pid = pg_catalog.pg_backend_pid()
         and c.transaction_id = pg_catalog.txid_current()
         and c.session_user_name = session_user
         and c.context_token::text = current_setting(
           'app.system_maintenance_token', true
         )
         and c.reason = current_setting('app.system_maintenance_reason', true);
    else
      raise exception 'An authenticated actor or validated system maintenance context is required'
        using errcode = '42501';
    end if;
  else
    v_role := private.current_role();
    if v_role is null then
      raise exception 'An active profile is required for audited changes'
        using errcode = '42501';
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new);
  end if;
  v_record := coalesce(v_new, v_old);

  insert into public.audit_logs (
    actor_id, actor_type, system_reason, action, table_name, record_id,
    old_data, new_data
  )
  values (
    case when v_actor_type = 'user' then v_actor else null end,
    v_actor_type,
    v_system_reason,
    tg_op,
    tg_table_name,
    coalesce(v_record ->> 'id', v_record ->> 'sale_number'),
    v_old,
    v_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.audit_row_change()
  from public, anon, authenticated;
