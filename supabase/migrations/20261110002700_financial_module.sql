-- Financial operations: categorized expenses, other income, register movements,
-- payment-method reporting, and complete sale-to-register association.

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 80),
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.expenses
  add column category_id uuid
    references public.expense_categories (id) on delete restrict;
alter table public.cash_sessions
  add column sales_total_cop bigint not null default 0
    check (sales_total_cop >= 0),
  add column sales_by_method jsonb not null default '{}'::jsonb
    check (jsonb_typeof(sales_by_method) = 'object');

create table public.financial_incomes (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  cash_session_id uuid not null references public.cash_sessions (id) on delete restrict,
  description text not null check (length(btrim(description)) between 1 and 240),
  amount_cop bigint not null check (amount_cop > 0),
  income_date date not null default current_date,
  payment_method public.payment_method not null,
  notes text,
  created_at timestamptz not null default now(),
  check (notes is null or length(notes) <= 1000)
);
create index financial_incomes_date_idx
  on public.financial_incomes (income_date desc);
create index financial_incomes_session_idx
  on public.financial_incomes (cash_session_id, created_at desc);

alter table public.cash_movements
  add column income_id uuid
    references public.financial_incomes (id) on delete restrict;
alter table public.cash_movements
  drop constraint cash_movements_check,
  add constraint cash_movements_financial_reference_check
    check (
      (
        movement_type = 'sale_in'
        and sale_id is not null
        and expense_id is null
        and income_id is null
      )
      or (
        movement_type = 'expense_out'
        and expense_id is not null
        and sale_id is null
        and income_id is null
      )
      or (
        movement_type = 'deposit'
        and sale_id is null
        and expense_id is null
      )
      or (
        movement_type in ('opening', 'withdrawal', 'closing_adjustment')
        and sale_id is null
        and expense_id is null
        and income_id is null
      )
    );
create unique index cash_movements_one_income_idx
  on public.cash_movements (income_id) where income_id is not null;

alter table public.expense_categories enable row level security;
alter table public.financial_incomes enable row level security;

create policy expense_categories_admin_all
  on public.expense_categories for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
create policy financial_incomes_select_own_or_admin
  on public.financial_incomes for select to authenticated
  using (
    (select private.is_admin())
    or (
      created_by = (select auth.uid())
      and (select private.is_employee_or_admin())
    )
  );
create policy financial_incomes_admin_all
  on public.financial_incomes for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

grant select, insert, update on public.expense_categories to authenticated;
grant select on public.financial_incomes to authenticated;
grant select (category_id) on public.expenses to authenticated;
revoke delete on public.expense_categories from authenticated;
revoke insert, update, delete on public.financial_incomes from authenticated;
revoke insert, update, delete on public.expenses from authenticated;
revoke insert, update, delete on public.cash_movements from authenticated;

insert into public.expense_categories (id, name)
values
  ('e340c416-864f-4eb3-8cb9-000000000001', 'Arriendo'),
  ('e340c416-864f-4eb3-8cb9-000000000002', 'Servicios'),
  ('e340c416-864f-4eb3-8cb9-000000000003', 'Transporte'),
  ('e340c416-864f-4eb3-8cb9-000000000004', 'Empaques'),
  ('e340c416-864f-4eb3-8cb9-000000000005', 'Otros')
on conflict (name) do nothing;

create trigger set_updated_at
before update on public.expense_categories
for each row execute function private.set_updated_at();
create trigger audit_expense_categories
after insert or update or delete on public.expense_categories
for each row execute function private.audit_row_change();
create trigger audit_financial_incomes
after insert or update or delete on public.financial_incomes
for each row execute function private.audit_row_change();

create or replace function public.open_financial_cash_session(
  p_opening_cop bigint,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session_id uuid;
begin
  if v_actor is null or not private.is_employee_or_admin() then
    raise exception 'An authenticated employee or administrator is required'
      using errcode = '42501';
  end if;
  if p_opening_cop is null or p_opening_cop < 0
     or p_notes is not null and length(p_notes) > 1000 then
    raise exception 'Opening amount or notes are invalid'
      using errcode = '22023';
  end if;

  insert into public.cash_sessions (
    opened_by, opening_cop, expected_cop, notes
  )
  values (
    v_actor, p_opening_cop, p_opening_cop, nullif(btrim(p_notes), '')
  )
  returning id into v_session_id;

  if p_opening_cop > 0 then
    insert into public.cash_movements (
      cash_session_id, movement_type, amount_cop, created_by, description
    )
    values (
      v_session_id, 'opening', p_opening_cop, v_actor, 'Apertura de caja'
    );
  end if;
  return v_session_id;
end;
$$;

create or replace function public.record_financial_income(
  p_description text,
  p_amount_cop bigint,
  p_income_date date,
  p_payment_method public.payment_method,
  p_cash_session_id uuid,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_income_id uuid;
  v_session public.cash_sessions%rowtype;
begin
  if v_actor is null or not private.is_employee_or_admin() then
    raise exception 'An authenticated employee or administrator is required'
      using errcode = '42501';
  end if;
  if p_description is null
     or length(btrim(p_description)) not between 1 and 240
     or p_amount_cop is null or p_amount_cop <= 0
     or p_income_date is null or p_payment_method is null
     or p_cash_session_id is null
     or p_notes is not null and length(p_notes) > 1000 then
    raise exception 'Income details are invalid'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.payment_method_settings p
     where p.method = p_payment_method and p.enabled
  ) then
    raise exception 'Payment method is unavailable'
      using errcode = '22023';
  end if;

  select cs.* into v_session
    from public.cash_sessions cs
   where cs.id = p_cash_session_id
     and cs.status = 'open'
     and (cs.opened_by = v_actor or private.is_admin())
   for update;
  if not found then
    raise exception 'An accessible open cash session is required'
      using errcode = '42501';
  end if;

  insert into public.financial_incomes (
    created_by, cash_session_id, description, amount_cop, income_date,
    payment_method, notes
  )
  values (
    v_actor, p_cash_session_id, btrim(p_description), p_amount_cop,
    p_income_date, p_payment_method, nullif(btrim(p_notes), '')
  )
  returning id into v_income_id;

  if p_payment_method = 'cash' then
    insert into public.cash_movements (
      cash_session_id, movement_type, income_id, amount_cop, created_by,
      description
    )
    values (
      p_cash_session_id, 'deposit', v_income_id, p_amount_cop, v_actor,
      btrim(p_description)
    );
    update public.cash_sessions
       set expected_cop = expected_cop + p_amount_cop
     where id = p_cash_session_id and status = 'open';
  end if;

  return v_income_id;
end;
$$;

create or replace function public.record_cash_withdrawal(
  p_cash_session_id uuid,
  p_amount_cop bigint,
  p_description text,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.cash_sessions%rowtype;
  v_movement_id uuid;
begin
  if v_actor is null or not private.is_employee_or_admin() then
    raise exception 'An authenticated employee or administrator is required'
      using errcode = '42501';
  end if;
  if p_cash_session_id is null or p_amount_cop is null or p_amount_cop <= 0
     or p_description is null
     or length(btrim(p_description)) not between 1 and 240
     or p_notes is not null and length(p_notes) > 1000 then
    raise exception 'Withdrawal details are invalid'
      using errcode = '22023';
  end if;

  select cs.* into v_session
    from public.cash_sessions cs
   where cs.id = p_cash_session_id
     and cs.status = 'open'
     and (cs.opened_by = v_actor or private.is_admin())
   for update;
  if not found then
    raise exception 'An accessible open cash session is required'
      using errcode = '42501';
  end if;
  if v_session.expected_cop < p_amount_cop then
    raise exception 'Withdrawal exceeds the expected cash balance'
      using errcode = '23514';
  end if;

  insert into public.cash_movements (
    cash_session_id, movement_type, amount_cop, created_by, description
  )
  values (
    p_cash_session_id, 'withdrawal', p_amount_cop, v_actor,
    btrim(p_description) || case
      when nullif(btrim(p_notes), '') is null then ''
      else ' — ' || btrim(p_notes)
    end
  )
  returning id into v_movement_id;

  update public.cash_sessions
     set expected_cop = expected_cop - p_amount_cop
   where id = p_cash_session_id and status = 'open';
  return v_movement_id;
end;
$$;

create or replace function public.record_financial_expense(
  p_category_id uuid,
  p_description text,
  p_amount_cop bigint,
  p_expense_date date,
  p_payment_method public.payment_method,
  p_cash_session_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_expense_id uuid;
  v_session public.cash_sessions%rowtype;
begin
  if v_actor is null
     or private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an authenticated administrator can record expenses'
      using errcode = '42501';
  end if;
  if p_category_id is null or p_description is null
     or length(btrim(p_description)) not between 1 and 240
     or p_amount_cop is null or p_amount_cop <= 0
     or p_expense_date is null or p_payment_method is null
     or p_notes is not null and length(p_notes) > 1000 then
    raise exception 'Expense details are invalid'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.expense_categories c
     where c.id = p_category_id and c.active
  ) then
    raise exception 'An active expense category is required'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.payment_method_settings p
     where p.method = p_payment_method and p.enabled
  ) then
    raise exception 'Payment method is unavailable'
      using errcode = '22023';
  end if;
  if (p_payment_method = 'cash') <> (p_cash_session_id is not null) then
    raise exception 'Cash expenses require an open session; non-cash expenses do not'
      using errcode = '22023';
  end if;

  if p_cash_session_id is not null then
    select cs.* into v_session
      from public.cash_sessions cs
     where cs.id = p_cash_session_id
       and cs.status = 'open'
       and (cs.opened_by = v_actor or private.is_admin())
     for update;
    if not found then
      raise exception 'An accessible open cash session is required'
        using errcode = '42501';
    end if;
    if v_session.expected_cop < p_amount_cop then
      raise exception 'Expense exceeds the expected cash balance'
        using errcode = '23514';
    end if;
  end if;

  insert into public.expenses (
    created_by, category_id, description, amount_cop, expense_date,
    payment_method, cash_session_id, notes
  )
  values (
    v_actor, p_category_id, btrim(p_description), p_amount_cop,
    p_expense_date, p_payment_method, p_cash_session_id,
    nullif(btrim(p_notes), '')
  )
  returning id into v_expense_id;

  if p_cash_session_id is not null then
    insert into public.cash_movements (
      cash_session_id, movement_type, expense_id, amount_cop, created_by,
      description
    )
    values (
      p_cash_session_id, 'expense_out', v_expense_id, p_amount_cop,
      v_actor, btrim(p_description)
    );
    update public.cash_sessions
       set expected_cop = expected_cop - p_amount_cop
     where id = p_cash_session_id and status = 'open';
  end if;
  return v_expense_id;
end;
$$;

create or replace function private.attach_sale_to_active_cash_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session_id uuid;
begin
  if v_actor is null or not private.is_employee_or_admin() then
    raise exception 'An authenticated employee or administrator is required'
      using errcode = '42501';
  end if;
  if new.created_by is distinct from v_actor then
    raise exception 'A sale must be attributed to its authenticated cashier'
      using errcode = '42501';
  end if;

  if new.cash_session_id is null then
    select cs.id into v_session_id
      from public.cash_sessions cs
     where cs.opened_by = v_actor and cs.status = 'open'
     for update;
  else
    select cs.id into v_session_id
      from public.cash_sessions cs
     where cs.id = new.cash_session_id
       and cs.opened_by = v_actor
       and cs.status = 'open'
     for update;
  end if;
  if v_session_id is null then
    raise exception 'An open cash session is required for every sale'
      using errcode = '42501';
  end if;
  new.cash_session_id := v_session_id;
  return new;
end;
$$;

create trigger sales_require_cash_session
before insert on public.sales
for each row execute function private.attach_sale_to_active_cash_session();

create or replace function public.close_financial_cash_session(
  p_cash_session_id uuid,
  p_counted_cop bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_difference bigint;
  v_sales_total bigint;
  v_sales_by_method jsonb;
begin
  if v_actor is null or not private.is_employee_or_admin() then
    raise exception 'An authenticated employee or administrator is required'
      using errcode = '42501';
  end if;

  v_difference := public.close_cash_session(
    p_cash_session_id,
    p_counted_cop
  );

  select coalesce(sum(t.amount), 0)::bigint,
         coalesce(jsonb_object_agg(t.method, t.amount), '{}'::jsonb)
    into v_sales_total, v_sales_by_method
    from (
      select s.payment_method::text as method,
             sum(s.total_cop)::bigint as amount
        from public.sales s
       where s.cash_session_id = p_cash_session_id
         and s.status = 'completed'
       group by s.payment_method
    ) t;

  update public.cash_sessions
     set sales_total_cop = v_sales_total,
         sales_by_method = v_sales_by_method
   where id = p_cash_session_id and status = 'closed';

  return jsonb_build_object(
    'difference_cop', v_difference,
    'sales_total_cop', v_sales_total,
    'sales_by_method', v_sales_by_method
  );
end;
$$;

create or replace function public.admin_financial_report(
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  sales_cop bigint,
  sales_cost_cop bigint,
  gross_profit_cop bigint,
  operating_expenses_cop bigint,
  other_income_cop bigint,
  net_result_cop bigint,
  sale_count bigint,
  sales_by_method jsonb,
  expenses_by_category jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'Administrator access is required'
      using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_start >= p_end
     or p_end - p_start > interval '366 days' then
    raise exception 'Report period must be valid and no longer than 366 days'
      using errcode = '22023';
  end if;

  return query
  with period_sales as (
    select s.id, s.status, s.payment_method,
           case
             when s.status = 'voided' then 0::bigint
             else greatest(
               0::bigint,
               s.total_cop - case
                 when a.operation = 'refund' then a.amount_cop
                 else 0::bigint
               end
             )
           end as net_total,
           case
             when a.inventory_restored then 0::bigint
             else s.total_cost_cop
           end as recognized_cost
      from public.sales s
      left join public.sale_adjustments a on a.sale_id = s.id
     where s.created_at >= p_start and s.created_at < p_end
  ),
  sale_totals as (
    select coalesce(sum(net_total), 0)::bigint as revenue,
           coalesce(sum(recognized_cost), 0)::bigint as cost,
           count(*) filter (where status = 'completed')::bigint as count
      from period_sales
  ),
  method_totals as (
    select jsonb_object_agg(method, amount) as totals
      from (
        select p.payment_method::text as method,
               coalesce(sum(p.net_total), 0)::bigint as amount
          from period_sales p
         group by p.payment_method
      ) m
  ),
  expense_totals as (
    select coalesce(sum(e.amount_cop), 0)::bigint as amount
      from public.expenses e
     where e.expense_date >= p_start::date
       and e.expense_date < p_end::date
  ),
  income_totals as (
    select coalesce(sum(i.amount_cop), 0)::bigint as amount
      from public.financial_incomes i
     where i.income_date >= p_start::date
       and i.income_date < p_end::date
  ),
  category_totals as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('category', c.name, 'amount_cop', x.amount)
        order by x.amount desc, c.name
      ),
      '[]'::jsonb
    ) as totals
      from (
        select e.category_id, sum(e.amount_cop)::bigint as amount
          from public.expenses e
         where e.expense_date >= p_start::date
           and e.expense_date < p_end::date
         group by e.category_id
      ) x
      left join public.expense_categories c on c.id = x.category_id
  )
  select st.revenue, st.cost, st.revenue - st.cost, et.amount, it.amount,
         st.revenue - st.cost + it.amount - et.amount, st.count,
         coalesce(mt.totals, '{}'::jsonb), ct.totals
    from sale_totals st
    cross join expense_totals et
    cross join income_totals it
    cross join method_totals mt
    cross join category_totals ct;
end;
$$;

revoke all on function public.open_cash_session(bigint)
  from public, anon, authenticated;
revoke all on function public.record_expense(
  text, bigint, date, public.payment_method, uuid, text
) from public, anon, authenticated;
revoke all on function public.close_cash_session(uuid, bigint)
  from public, anon, authenticated;
revoke all on function private.attach_sale_to_active_cash_session()
  from public, anon, authenticated;
revoke all on function public.open_financial_cash_session(bigint, text)
  from public, anon, authenticated;
revoke all on function public.record_financial_income(
  text, bigint, date, public.payment_method, uuid, text
) from public, anon, authenticated;
revoke all on function public.record_cash_withdrawal(
  uuid, bigint, text, text
) from public, anon, authenticated;
revoke all on function public.record_financial_expense(
  uuid, text, bigint, date, public.payment_method, uuid, text
) from public, anon, authenticated;
revoke all on function public.close_financial_cash_session(uuid, bigint)
  from public, anon, authenticated;
revoke all on function public.admin_financial_report(timestamptz, timestamptz)
  from public, anon, authenticated;

grant execute on function public.open_financial_cash_session(bigint, text)
  to authenticated;
grant execute on function public.close_financial_cash_session(uuid, bigint)
  to authenticated;
grant execute on function public.record_financial_income(
  text, bigint, date, public.payment_method, uuid, text
) to authenticated;
grant execute on function public.record_cash_withdrawal(
  uuid, bigint, text, text
) to authenticated;
grant execute on function public.record_financial_expense(
  uuid, text, bigint, date, public.payment_method, uuid, text
) to authenticated;
grant execute on function public.admin_financial_report(timestamptz, timestamptz)
  to authenticated;
