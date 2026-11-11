create table public.business_settings (
  id smallint primary key default 1 check (id = 1),
  business_name text not null
    check (length(btrim(business_name)) between 1 and 160),
  phone text
    check (phone is null or length(btrim(phone)) between 1 and 40),
  email text
    check (
      email is null
      or (
        length(btrim(email)) between 3 and 254
        and btrim(email) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      )
    ),
  address text
    check (address is null or length(btrim(address)) between 1 and 300),
  updated_at timestamptz not null default now()
);

alter table public.business_settings enable row level security;

create policy business_settings_select_authenticated
  on public.business_settings for select to authenticated
  using ((select private.is_employee_or_admin()));

create policy business_settings_update_admin
  on public.business_settings for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

revoke all on public.business_settings from public, anon, authenticated;

grant select (
  id, business_name, phone, email, address, updated_at
) on public.business_settings to authenticated;
grant update (business_name, phone, email, address)
  on public.business_settings to authenticated;

create trigger set_business_settings_updated_at
before update on public.business_settings
for each row execute function private.set_updated_at();

create trigger audit_business_settings
after insert or update or delete on public.business_settings
for each row execute function private.audit_row_change();

select private.begin_system_maintenance('initialize business settings');

insert into public.business_settings (id, business_name)
values (1, 'Perfumeria SC');

select private.end_system_maintenance();
