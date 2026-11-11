begin;

select private.begin_system_maintenance(
  'Bootstrap initial local administrator profile'
);

do $bootstrap$
declare
  v_user_id uuid;
begin
  select id
    into v_user_id
    from auth.users
   where lower(email) = lower('tomioka1246@gmail.com');

  if v_user_id is null then
    raise exception 'No Auth user exists with the supplied email';
  end if;

  if exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'The Auth user already has a profile';
  end if;

  insert into public.profiles (id, role, display_name)
  values (v_user_id, 'employee', 'Administrador inicial');
end;
$bootstrap$;

select private.end_system_maintenance();

commit;
