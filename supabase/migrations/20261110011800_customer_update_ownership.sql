-- Employees may update only customer records they created; administrators may
-- update any customer record.

drop policy customers_update_admin_or_owner on public.customers;

create policy customers_update_own_or_admin
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
