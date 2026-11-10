-- Allow employees to consult operational stock without exposing costs.

revoke select on public.materials from authenticated;
grant select (
  id, name, base_unit, on_hand_qty, active, created_at, updated_at
) on public.materials to authenticated;

create policy materials_employee_inventory_select
  on public.materials for select to authenticated
  using (
    active
    and (select private.is_employee_or_admin())
  );

drop policy customers_update_authenticated on public.customers;
create policy customers_update_admin_or_owner
  on public.customers for update to authenticated
  using (
    (select private.is_admin())
    or (
      created_by = (select auth.uid())
      and (select private.is_employee_or_admin())
    )
  )
  with check (
    (select private.is_admin())
    or (
      created_by = (select auth.uid())
      and (select private.is_employee_or_admin())
    )
  );
