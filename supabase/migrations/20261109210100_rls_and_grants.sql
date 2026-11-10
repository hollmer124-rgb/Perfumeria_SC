-- Migration 20261109210100: grants, RLS, and role-bound authorization helpers.

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.current_role()
returns public.app_role
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return null;
  end if;

  select p.role
    into v_role
    from public.profiles as p
   where p.id = v_uid;

  return v_role;
end;
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null
    and private.current_role() = 'admin'::public.app_role,
    false
  );
$$;

create or replace function private.is_employee_or_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null
    and private.current_role() in (
      'admin'::public.app_role,
      'employee'::public.app_role
    ),
    false
  );
$$;

revoke all on function private.current_role() from public, anon;
revoke all on function private.is_admin() from public, anon;
revoke all on function private.is_employee_or_admin() from public, anon;
grant execute on function private.current_role() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_employee_or_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.perfumes enable row level security;
alter table public.retail_products enable row level security;
alter table public.materials enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_components enable row level security;
alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_material_usage enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.expenses enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_select_self_or_admin
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));
create policy profiles_insert_admin
  on public.profiles for insert to authenticated
  with check ((select private.is_admin()));
create policy profiles_update_self_or_admin
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()))
  with check (
    (select private.is_admin())
    or (
      id = (select auth.uid())
      and role = (select private.current_role())
    )
  );
create policy profiles_delete_admin
  on public.profiles for delete to authenticated
  using ((select private.is_admin()));

create policy perfumes_select_active_or_admin
  on public.perfumes for select to authenticated
  using (
    (select private.is_employee_or_admin())
    and (active or (select private.is_admin()))
  );
create policy perfumes_admin_all
  on public.perfumes for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy retail_products_select_active_or_admin
  on public.retail_products for select to authenticated
  using (
    (select private.is_employee_or_admin())
    and (active or (select private.is_admin()))
  );
create policy retail_products_admin_insert
  on public.retail_products for insert to authenticated
  with check ((select private.is_admin()));
create policy retail_products_admin_update
  on public.retail_products for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
create policy retail_products_admin_delete
  on public.retail_products for delete to authenticated
  using ((select private.is_admin()));

create policy materials_admin_all
  on public.materials for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy recipes_select_active_or_admin
  on public.recipes for select to authenticated
  using (
    (select private.is_employee_or_admin())
    and (status = 'active' or (select private.is_admin()))
  );
create policy recipes_admin_all
  on public.recipes for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy recipe_components_admin_all
  on public.recipe_components for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy customers_select_authenticated
  on public.customers for select to authenticated
  using ((select private.is_employee_or_admin()));
create policy customers_insert_authenticated
  on public.customers for insert to authenticated
  with check (
    (select private.is_employee_or_admin())
    and (
      (select private.is_admin())
      or created_by = (select auth.uid())
    )
  );
create policy customers_update_authenticated
  on public.customers for update to authenticated
  using ((select private.is_employee_or_admin()))
  with check ((select private.is_employee_or_admin()));
create policy customers_delete_admin
  on public.customers for delete to authenticated
  using ((select private.is_admin()));

create policy suppliers_admin_all
  on public.suppliers for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy sales_select_own_or_admin
  on public.sales for select to authenticated
  using (
    (select private.is_admin())
    or (
      created_by = (select auth.uid())
      and (select private.is_employee_or_admin())
    )
  );
create policy sales_insert_by_rpc_only
  on public.sales for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select private.is_employee_or_admin())
  );
create policy sales_admin_update
  on public.sales for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy sale_items_select_sale_owner_or_admin
  on public.sale_items for select to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1
      from public.sales as s
      where s.id = sale_items.sale_id
        and s.created_by = (select auth.uid())
    )
  );
create policy sale_items_admin_all
  on public.sale_items for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy sale_material_usage_admin_all
  on public.sale_material_usage for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy purchases_admin_all
  on public.purchases for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy purchase_items_admin_all
  on public.purchase_items for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy inventory_movements_admin_select
  on public.inventory_movements for select to authenticated
  using ((select private.is_admin()));

create policy expenses_admin_all
  on public.expenses for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy cash_sessions_select_own_or_admin
  on public.cash_sessions for select to authenticated
  using (
    (select private.is_admin())
    or (
      opened_by = (select auth.uid())
      and (select private.is_employee_or_admin())
    )
  );
create policy cash_sessions_admin_all
  on public.cash_sessions for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy cash_movements_select_session_owner_or_admin
  on public.cash_movements for select to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1
      from public.cash_sessions as cs
      where cs.id = cash_movements.cash_session_id
        and cs.opened_by = (select auth.uid())
    )
      and cash_movements.movement_type <> 'expense_out'
      and (select private.is_employee_or_admin())
  );
create policy cash_movements_admin_all
  on public.cash_movements for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy audit_logs_admin_select
  on public.audit_logs for select to authenticated
  using ((select private.is_admin()));

grant usage on type
  public.app_role,
  public.material_unit,
  public.component_mode,
  public.recipe_status,
  public.retail_product_type,
  public.payment_method,
  public.sale_status,
  public.purchase_status,
  public.inventory_movement_type,
  public.cash_session_status,
  public.cash_movement_type
to authenticated;

grant select (id, role, display_name, phone, created_at, updated_at)
  on public.profiles to authenticated;
grant update (display_name, phone)
  on public.profiles to authenticated;
grant insert (id, role, display_name, phone)
  on public.profiles to authenticated;
grant delete on public.profiles to authenticated;

grant select on public.perfumes to authenticated;
grant insert, update, delete on public.perfumes to authenticated;

grant select (
  id, perfume_id, product_type, sku, name, size_ml, price_cop, stock_qty,
  active, created_at, updated_at
) on public.retail_products to authenticated;
grant insert (
  perfume_id, product_type, sku, name, size_ml, price_cop, active
) on public.retail_products to authenticated;
grant update (
  perfume_id, product_type, sku, name, size_ml, price_cop, active
) on public.retail_products to authenticated;
grant delete on public.retail_products to authenticated;

grant select on public.materials to authenticated;
grant insert (name, base_unit, minimum_qty, active)
  on public.materials to authenticated;
grant update (name, base_unit, minimum_qty, active)
  on public.materials to authenticated;
grant delete on public.materials to authenticated;
grant select (
  id, perfume_id, size_ml, version, status, price_cop, created_by,
  created_at, updated_at
) on public.recipes to authenticated;
grant insert, update, delete on public.recipes to authenticated;
grant select, insert, update, delete on public.recipe_components to authenticated;

grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.suppliers to authenticated;

grant select (
  id, sale_number, created_by, customer_id, cash_session_id, status,
  payment_method, subtotal_cop, total_cop, notes, created_at, updated_at
) on public.sales to authenticated;
grant select (
  id, sale_id, item_type, retail_product_id, recipe_id, item_name_snapshot,
  product_type_snapshot, size_ml_snapshot, recipe_version_snapshot, quantity,
  unit_price_cop, line_total_cop, created_at
) on public.sale_items to authenticated;
grant select on public.sale_material_usage to authenticated;

grant select on public.purchases to authenticated;
grant insert (supplier_id, created_by, purchased_at, notes)
  on public.purchases to authenticated;
grant update (purchased_at, notes) on public.purchases to authenticated;
grant delete on public.purchases to authenticated;
grant select, insert, update, delete on public.purchase_items to authenticated;
grant select on public.inventory_movements to authenticated;
grant select on public.expenses to authenticated;

grant select on public.cash_sessions to authenticated;
grant select on public.cash_movements to authenticated;
grant select on public.audit_logs to authenticated;

revoke update, delete on public.sales from authenticated;
revoke update, delete on public.sale_items from authenticated;
revoke update, delete on public.sale_material_usage from authenticated;
revoke update, delete on public.inventory_movements from authenticated;
revoke update, delete on public.cash_movements from authenticated;
revoke insert, update, delete on public.audit_logs from authenticated;
