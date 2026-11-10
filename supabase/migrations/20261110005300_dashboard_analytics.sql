-- Bounded, role-aware dashboard metrics and administrator-filtered reports.

create or replace function public.dashboard_metrics(
  p_day_start timestamptz,
  p_month_start timestamptz,
  p_now timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_admin boolean;
  v_day_sales bigint;
  v_month_sales bigint;
  v_day_cost bigint;
  v_month_cost bigint;
  v_month_expenses bigint;
  v_month_other_income bigint;
  v_previous_month_sales bigint;
  v_previous_month_end timestamptz;
  v_transactions bigint;
  v_top_products jsonb;
  v_low_stock_materials jsonb;
  v_low_stock_products jsonb;
  v_recent_sales jsonb;
  v_cash jsonb;
  v_timeline jsonb;
begin
  if v_actor is null or not private.is_employee_or_admin() then
    raise exception 'An authenticated employee or administrator is required'
      using errcode = '42501';
  end if;
  if p_day_start is null or p_month_start is null or p_now is null
     or p_day_start >= p_now or p_month_start >= p_now
     or p_day_start < p_month_start
     or p_now - p_month_start > interval '32 days' then
    raise exception 'Dashboard period boundaries are invalid'
      using errcode = '22023';
  end if;
  v_admin := private.is_admin();

  select
    coalesce(sum(greatest(
      0::bigint,
      s.total_cop - case when a.operation = 'refund' then a.amount_cop else 0 end
    )) filter (
      where s.created_at >= p_day_start and s.created_at < p_now
    ), 0)::bigint,
    coalesce(sum(greatest(
      0::bigint,
      s.total_cop - case when a.operation = 'refund' then a.amount_cop else 0 end
    )) filter (
      where s.created_at >= p_month_start and s.created_at < p_now
    ), 0)::bigint,
    coalesce(sum(case when coalesce(a.inventory_restored, false)
      then 0 else s.total_cost_cop end) filter (
      where s.created_at >= p_day_start and s.created_at < p_now
    ), 0)::bigint,
    coalesce(sum(case when coalesce(a.inventory_restored, false)
      then 0 else s.total_cost_cop end) filter (
      where s.created_at >= p_month_start and s.created_at < p_now
    ), 0)::bigint,
    count(*) filter (
      where s.created_at >= p_day_start and s.created_at < p_now
    )::bigint
  into v_day_sales, v_month_sales, v_day_cost, v_month_cost, v_transactions
  from public.sales s
  left join public.sale_adjustments a on a.sale_id = s.id
  where s.status = 'completed'
    and s.created_at >= p_month_start
    and s.created_at < p_now
    and (v_admin or s.created_by = v_actor);

  v_previous_month_end := least(p_month_start, p_now - interval '1 month');
  select coalesce(sum(greatest(
    0::bigint,
    s.total_cop - case when a.operation = 'refund' then a.amount_cop else 0 end
  )), 0)::bigint
    into v_previous_month_sales
    from public.sales s
    left join public.sale_adjustments a on a.sale_id = s.id
   where s.status = 'completed'
     and s.created_at >= p_month_start - interval '1 month'
     and s.created_at < v_previous_month_end
     and (v_admin or s.created_by = v_actor);

  if v_admin then
    select coalesce(sum(e.amount_cop), 0)::bigint
      into v_month_expenses
      from public.expenses e
     where e.expense_date >= (p_month_start at time zone 'America/Bogota')::date
       and e.expense_date <= (p_now at time zone 'America/Bogota')::date;
    select coalesce(sum(i.amount_cop), 0)::bigint
      into v_month_other_income
      from public.financial_incomes i
     where i.income_date >= (p_month_start at time zone 'America/Bogota')::date
       and i.income_date <= (p_now at time zone 'America/Bogota')::date;
  end if;

  with daily_sales as (
    select (s.created_at at time zone 'America/Bogota')::date as sale_date,
           sum(greatest(
             0::bigint,
             s.total_cop - case when a.operation = 'refund' then a.amount_cop else 0 end
           ))::bigint as sales_cop,
           count(*)::bigint as transactions,
           sum(case when coalesce(a.inventory_restored, false)
             then 0 else s.total_cost_cop end)::bigint as cost_cop
      from public.sales s
      left join public.sale_adjustments a on a.sale_id = s.id
     where s.status = 'completed'
       and s.created_at >= p_now - interval '29 days'
       and s.created_at < p_now
       and (v_admin or s.created_by = v_actor)
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'period', sale_date,
    'sales_cop', sales_cop,
    'transactions', transactions,
    'historical_cost_cop', case when v_admin then cost_cop else null end
  ) order by sale_date), '[]'::jsonb)
    into v_timeline
    from daily_sales;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    into v_top_products
    from (
      select si.item_name_snapshot as name,
             case
               when si.item_type = 'recipe' then 'replica'
               else si.product_type_snapshot::text
             end as category,
             sum(si.quantity)::numeric as units,
             sum(greatest(
               0::bigint,
               si.line_total_cop
               - round(
                   s.discount_cop::numeric * si.line_total_cop
                   / greatest(s.subtotal_cop, 1)::numeric
                 )::bigint
               - case when a.operation = 'refund' then round(
                   a.amount_cop::numeric
                   * greatest(
                       0::bigint,
                       si.line_total_cop
                       - round(
                           s.discount_cop::numeric * si.line_total_cop
                           / greatest(s.subtotal_cop, 1)::numeric
                         )::bigint
                     )
                   / greatest(s.total_cop, 1)::numeric
                 )::bigint else 0 end
             ))::bigint as sales_cop
        from public.sale_items si
        join public.sales s on s.id = si.sale_id
        left join public.sale_adjustments a on a.sale_id = s.id
       where s.status = 'completed'
         and s.created_at >= p_month_start
         and s.created_at < p_now
         and (v_admin or s.created_by = v_actor)
       group by si.item_name_snapshot, si.item_type, si.product_type_snapshot
       order by sum(si.quantity) desc, sum(si.line_total_cop) desc
       limit 8
    ) t;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    into v_low_stock_materials
    from (
      select m.id, m.name, m.category, m.base_unit::text as unit,
             m.on_hand_qty as on_hand, m.minimum_qty as minimum
        from public.materials m
       where m.active and m.on_hand_qty <= m.minimum_qty
       order by (m.on_hand_qty / greatest(m.minimum_qty, 1)) asc, m.name
       limit 8
    ) t;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    into v_low_stock_products
    from (
      select rp.id, rp.name, rp.product_type::text as category,
             rp.stock_qty as on_hand, rp.minimum_qty as minimum
        from public.retail_products rp
       where rp.active and rp.stock_qty <= rp.minimum_qty
       order by rp.stock_qty asc, rp.name
       limit 8
    ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
    into v_recent_sales
    from (
      select s.id, s.sale_number,
             greatest(
               0::bigint,
               s.total_cop - case when a.operation = 'refund' then a.amount_cop else 0 end
             ) as total_cop,
             s.payment_method::text as payment_method,
             s.created_at, s.created_by,
             case when v_admin then
               case when coalesce(a.inventory_restored, false)
                 then 0 else s.total_cost_cop end
               else null end as cost_cop
        from public.sales s
        left join public.sale_adjustments a on a.sale_id = s.id
       where s.status = 'completed'
         and s.created_at >= p_month_start
         and s.created_at < p_now
         and (v_admin or s.created_by = v_actor)
       order by s.created_at desc
       limit 8
    ) t;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', cs.id,
      'opened_at', cs.opened_at,
      'expected_cop', cs.expected_cop
    )),
    '[]'::jsonb
  )
    into v_cash
    from public.cash_sessions cs
   where cs.status = 'open'
     and (v_admin or cs.opened_by = v_actor);

  return jsonb_build_object(
    'day_sales_cop', v_day_sales,
    'month_sales_cop', v_month_sales,
    'day_transactions', v_transactions,
    'day_gross_profit_cop',
      case when v_admin then v_day_sales - v_day_cost else null end,
    'month_gross_profit_cop',
      case when v_admin then v_month_sales - v_month_cost else null end,
    'month_expenses_cop', case when v_admin then v_month_expenses else null end,
    'month_other_income_cop',
      case when v_admin then v_month_other_income else null end,
    'month_net_result_cop',
      case when v_admin then
        v_month_sales - v_month_cost + v_month_other_income - v_month_expenses
      else null end,
    'previous_month_sales_cop', v_previous_month_sales,
    'month_sales_change_cop', v_month_sales - v_previous_month_sales,
    'timeline', v_timeline,
    'top_products', v_top_products,
    'low_stock_materials', v_low_stock_materials,
    'low_stock_products', v_low_stock_products,
    'recent_sales', v_recent_sales,
    'open_cash_sessions', v_cash
  );
end;
$$;

create or replace function public.admin_operational_report(
  p_start timestamptz,
  p_end timestamptz,
  p_bucket text default 'day',
  p_product_id uuid default null,
  p_category text default null,
  p_employee_id uuid default null,
  p_compare_start timestamptz default null,
  p_compare_end timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_summary jsonb;
  v_comparison jsonb;
  v_timeline jsonb;
  v_sales_by_category jsonb;
  v_top_products jsonb;
  v_material_usage jsonb;
  v_purchases jsonb;
  v_expenses jsonb;
  v_cash_movements jsonb;
  v_types jsonb;
begin
  if auth.uid() is null
     or private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'Administrator access is required'
      using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_start >= p_end
     or p_end - p_start > interval '366 days'
     or p_bucket is null
     or p_bucket not in ('day', 'week', 'month')
     or (p_category is not null and p_category not in ('original', '1.1', 'replica'))
     or ((p_compare_start is null) <> (p_compare_end is null))
     or (p_compare_start is not null and
       (p_compare_start >= p_compare_end
        or p_compare_end - p_compare_start > interval '366 days')) then
    raise exception 'Report filters or period are invalid'
      using errcode = '22023';
  end if;

  with matched_sales as (
    select s.id, s.status, s.created_at,
           s.total_cop, s.total_cost_cop, s.subtotal_cop, s.discount_cop,
           a.operation as adjustment_operation,
           a.amount_cop as adjustment_amount_cop,
           a.inventory_restored,
           case
             when p_product_id is null and p_category is null then s.total_cop
             else greatest(
               0::bigint,
               coalesce(sum(si.line_total_cop), 0)::bigint
               - round(
                   s.discount_cop::numeric
                   * coalesce(sum(si.line_total_cop), 0)
                   / greatest(s.subtotal_cop, 1)::numeric
                 )::bigint
             )
           end as matched_sales_cop,
           case
             when coalesce(a.inventory_restored, false) then 0
             when p_product_id is null and p_category is null then s.total_cost_cop
             else coalesce(sum(si.line_cost_cop), 0)::bigint
           end as matched_cost_cop
      from public.sales s
      left join public.sale_adjustments a on a.sale_id = s.id
      left join public.sale_items si
        on si.sale_id = s.id
       and (p_product_id is null or
            si.retail_product_id = p_product_id or si.recipe_id = p_product_id)
       and (p_category is null or
            case when si.item_type = 'recipe' then 'replica'
                 else si.product_type_snapshot::text end = p_category)
     where s.created_at >= p_start
       and s.created_at < p_end
       and (p_employee_id is null or s.created_by = p_employee_id)
       and (p_product_id is null or exists (
         select 1 from public.sale_items matching_item
          where matching_item.sale_id = s.id
            and (matching_item.retail_product_id = p_product_id
                 or matching_item.recipe_id = p_product_id)
       ))
       and (p_category is null or exists (
         select 1 from public.sale_items matching_item
          where matching_item.sale_id = s.id
            and case when matching_item.item_type = 'recipe' then 'replica'
                     else matching_item.product_type_snapshot::text end = p_category
       ))
     group by s.id, a.operation, a.amount_cop, a.inventory_restored
  ),
  selected_sales as (
    select m.id, m.status, m.created_at,
           greatest(
             0::bigint,
             m.matched_sales_cop
             - case when m.adjustment_operation = 'refund' then
                 case
                   when p_product_id is null and p_category is null
                     then m.adjustment_amount_cop
                   else round(
                     m.adjustment_amount_cop::numeric * m.matched_sales_cop
                     / greatest(m.total_cop, 1)::numeric
                   )::bigint
                 end
               else 0 end
           ) as matched_sales_cop,
           m.matched_cost_cop
      from matched_sales m
  ),
  totals as (
    select coalesce(sum(s.matched_sales_cop) filter (where s.status = 'completed'), 0)::bigint revenue,
           coalesce(sum(s.matched_cost_cop) filter (where s.status = 'completed'), 0)::bigint cost,
           count(*) filter (where s.status = 'completed')::bigint transactions
      from selected_sales s
  ),
  expenses_total as (
    select coalesce(sum(e.amount_cop), 0)::bigint amount
      from public.expenses e
     where e.expense_date >= (p_start at time zone 'America/Bogota')::date
       and e.expense_date < (p_end at time zone 'America/Bogota')::date
       and (p_employee_id is null or e.created_by = p_employee_id)
  ),
  income_total as (
    select coalesce(sum(i.amount_cop), 0)::bigint amount
      from public.financial_incomes i
     where i.income_date >= (p_start at time zone 'America/Bogota')::date
       and i.income_date < (p_end at time zone 'America/Bogota')::date
       and (p_employee_id is null or i.created_by = p_employee_id)
  )
  select jsonb_build_object(
    'sales_cop', t.revenue,
    'sales_cost_cop', t.cost,
    'gross_profit_cop', t.revenue - t.cost,
    'operating_expenses_cop', e.amount,
    'other_income_cop', i.amount,
    'net_result_cop', t.revenue - t.cost + i.amount - e.amount,
    'sale_count', t.transactions
  )
    into v_summary
    from totals t cross join expenses_total e cross join income_total i;

  with matched_sales as (
    select s.id, s.status, s.created_at,
           s.total_cop, s.total_cost_cop, s.subtotal_cop, s.discount_cop,
           a.operation as adjustment_operation,
           a.amount_cop as adjustment_amount_cop,
           a.inventory_restored,
           case
             when p_product_id is null and p_category is null then s.total_cop
             else greatest(
               0::bigint,
               coalesce(sum(si.line_total_cop), 0)::bigint
               - round(
                   s.discount_cop::numeric
                   * coalesce(sum(si.line_total_cop), 0)
                   / greatest(s.subtotal_cop, 1)::numeric
                 )::bigint
             )
           end as matched_sales_cop,
           case
             when coalesce(a.inventory_restored, false) then 0
             when p_product_id is null and p_category is null then s.total_cost_cop
             else coalesce(sum(si.line_cost_cop), 0)::bigint
           end as matched_cost_cop
      from public.sales s
      left join public.sale_adjustments a on a.sale_id = s.id
      left join public.sale_items si
        on si.sale_id = s.id
       and (p_product_id is null or
            si.retail_product_id = p_product_id or si.recipe_id = p_product_id)
       and (p_category is null or
            case when si.item_type = 'recipe' then 'replica'
                 else si.product_type_snapshot::text end = p_category)
     where s.created_at >= p_start and s.created_at < p_end
       and (p_employee_id is null or s.created_by = p_employee_id)
       and (p_product_id is null or exists (
         select 1 from public.sale_items matching_item
          where matching_item.sale_id = s.id
            and (matching_item.retail_product_id = p_product_id
                 or matching_item.recipe_id = p_product_id)
       ))
       and (p_category is null or exists (
         select 1 from public.sale_items matching_item
          where matching_item.sale_id = s.id
            and case when matching_item.item_type = 'recipe' then 'replica'
                     else matching_item.product_type_snapshot::text end = p_category
       ))
     group by s.id, a.operation, a.amount_cop, a.inventory_restored
  ),
  selected_sales as (
    select m.id, m.status, m.created_at,
           greatest(
             0::bigint,
             m.matched_sales_cop
             - case when m.adjustment_operation = 'refund' then
                 case
                   when p_product_id is null and p_category is null
                     then m.adjustment_amount_cop
                   else round(
                     m.adjustment_amount_cop::numeric * m.matched_sales_cop
                     / greatest(m.total_cop, 1)::numeric
                   )::bigint
                 end
               else 0 end
           ) as matched_sales_cop,
           m.matched_cost_cop
      from matched_sales m
  ),
  bucketed as (
    select date_trunc(
      p_bucket,
      s.created_at at time zone 'America/Bogota'
    )::date as bucket_date,
    sum(s.matched_sales_cop) filter (where s.status = 'completed')::bigint as sales_cop,
    count(*) filter (where s.status = 'completed')::bigint as transactions,
    sum(s.matched_cost_cop) filter (where s.status = 'completed')::bigint as cost_cop
      from selected_sales s
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'period', bucket_date,
    'sales_cop', coalesce(sales_cop, 0),
    'transactions', coalesce(transactions, 0),
    'historical_cost_cop', case when sales_cop is null then 0
                                else coalesce(cost_cop, 0) end
  ) order by bucket_date), '[]'::jsonb)
    into v_timeline
    from bucketed;

  with selected_sales as (
    select s.id
      from public.sales s
      left join public.sale_adjustments a on a.sale_id = s.id
     where s.created_at >= p_start and s.created_at < p_end
       and s.status = 'completed'
       and not coalesce(a.inventory_restored, false)
       and (p_employee_id is null or s.created_by = p_employee_id)
       and (
         p_product_id is null
         or exists (
           select 1 from public.sale_items si
            where si.sale_id = s.id
              and (si.retail_product_id = p_product_id or si.recipe_id = p_product_id)
         )
       )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'category', t.category,
    'sales_cop', t.sales_cop,
    'units', t.units
  ) order by t.sales_cop desc), '[]'::jsonb)
    into v_sales_by_category
    from (
      select case when si.item_type = 'recipe' then 'replica'
                  else si.product_type_snapshot::text end category,
             sum(greatest(
               0::bigint,
               si.line_total_cop
               - round(
                   s.discount_cop::numeric * si.line_total_cop
                   / greatest(s.subtotal_cop, 1)::numeric
                 )::bigint
               - case when a.operation = 'refund' then round(
                   a.amount_cop::numeric
                   * greatest(
                       0::bigint,
                       si.line_total_cop
                       - round(
                           s.discount_cop::numeric * si.line_total_cop
                           / greatest(s.subtotal_cop, 1)::numeric
                         )::bigint
                     )
                   / greatest(s.total_cop, 1)::numeric
                 )::bigint else 0 end
             ))::bigint sales_cop,
             sum(si.quantity)::numeric units
        from public.sale_items si
        join selected_sales ss on ss.id = si.sale_id
        join public.sales s on s.id = ss.id
        left join public.sale_adjustments a on a.sale_id = s.id
       where (p_category is null or
              case when si.item_type = 'recipe' then 'replica'
                   else si.product_type_snapshot::text end = p_category)
         and (p_product_id is null or
              si.retail_product_id = p_product_id or si.recipe_id = p_product_id)
       group by 1
    ) t;

  with selected_sales as (
    select s.id
      from public.sales s
      left join public.sale_adjustments a on a.sale_id = s.id
     where s.created_at >= p_start and s.created_at < p_end
       and s.status = 'completed'
       and not coalesce(a.inventory_restored, false)
       and (p_employee_id is null or s.created_by = p_employee_id)
       and (
         p_category is null or exists (
           select 1 from public.sale_items si
            where si.sale_id = s.id
              and case when si.item_type = 'recipe' then 'replica'
                       else si.product_type_snapshot::text end = p_category
         )
       )
  )
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    into v_top_products
    from (
      select si.item_name_snapshot as name,
             case when si.item_type = 'recipe' then 'replica'
                  else si.product_type_snapshot::text end as category,
             sum(si.quantity)::numeric as units,
             sum(greatest(
               0::bigint,
               si.line_total_cop
               - round(
                   s.discount_cop::numeric * si.line_total_cop
                   / greatest(s.subtotal_cop, 1)::numeric
                 )::bigint
               - case when a.operation = 'refund' then round(
                   a.amount_cop::numeric
                   * greatest(
                       0::bigint,
                       si.line_total_cop
                       - round(
                           s.discount_cop::numeric * si.line_total_cop
                           / greatest(s.subtotal_cop, 1)::numeric
                         )::bigint
                     )
                   / greatest(s.total_cop, 1)::numeric
                 )::bigint else 0 end
             ))::bigint as sales_cop,
             sum(si.line_cost_cop)::bigint as historical_cost_cop
        from public.sale_items si
        join selected_sales ss on ss.id = si.sale_id
        join public.sales s on s.id = si.sale_id
        left join public.sale_adjustments a on a.sale_id = s.id
       where (p_product_id is null or
              si.retail_product_id = p_product_id or si.recipe_id = p_product_id)
       group by si.item_name_snapshot, si.item_type, si.product_type_snapshot
       order by sum(si.line_total_cop) desc
       limit 100
    ) t;

  with selected_sales as (
    select s.id
      from public.sales s
     where s.created_at >= p_start and s.created_at < p_end
       and s.status = 'completed'
       and (p_employee_id is null or s.created_by = p_employee_id)
       and (
         p_category is null or exists (
           select 1 from public.sale_items si
            where si.sale_id = s.id
              and case when si.item_type = 'recipe' then 'replica'
                       else si.product_type_snapshot::text end = p_category
         )
       )
       and (
         p_product_id is null or exists (
           select 1 from public.sale_items si
            where si.sale_id = s.id
              and (si.retail_product_id = p_product_id or si.recipe_id = p_product_id)
         )
       )
  )
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    into v_material_usage
    from (
      select u.material_name_snapshot as material,
             u.unit_snapshot::text as unit,
             sum(u.quantity_used)::numeric as quantity_used,
             sum(u.total_cost_cop)::bigint as historical_cost_cop
        from public.sale_material_usage u
        join public.sale_items si on si.id = u.sale_item_id
        join selected_sales ss on ss.id = si.sale_id
       where p_product_id is null
          or si.retail_product_id = p_product_id or si.recipe_id = p_product_id
       group by u.material_name_snapshot, u.unit_snapshot
       order by sum(u.quantity_used) desc
       limit 100
    ) t;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    into v_purchases
    from (
      select p.id, p.status::text as status, p.purchased_at, p.received_at,
             p.total_cop, p.created_by,
             count(pi.id)::bigint as item_count
        from public.purchases p
        left join public.purchase_items pi on pi.purchase_id = p.id
       where coalesce(p.received_at, p.purchased_at) >= p_start
         and coalesce(p.received_at, p.purchased_at) < p_end
         and (p_employee_id is null or p.created_by = p_employee_id)
       group by p.id
       order by p.purchased_at desc
       limit 100
    ) t;

  select coalesce(jsonb_agg(jsonb_build_object(
    'category', coalesce(c.name, 'Sin categoría'),
    'amount_cop', t.amount_cop
  ) order by t.amount_cop desc), '[]'::jsonb)
    into v_expenses
    from (
      select e.category_id, sum(e.amount_cop)::bigint as amount_cop
        from public.expenses e
       where e.expense_date >= (p_start at time zone 'America/Bogota')::date
         and e.expense_date < (p_end at time zone 'America/Bogota')::date
         and (p_employee_id is null or e.created_by = p_employee_id)
       group by e.category_id
    ) t
    left join public.expense_categories c on c.id = t.category_id;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    into v_cash_movements
    from (
      select cm.movement_type::text as movement_type,
             sum(cm.amount_cop)::bigint as amount_cop,
             count(*)::bigint as movement_count
        from public.cash_movements cm
       where cm.created_at >= p_start and cm.created_at < p_end
         and (p_employee_id is null or cm.created_by = p_employee_id)
       group by cm.movement_type
       order by cm.movement_type
    ) t;

  with selected_sales as (
    select s.id
      from public.sales s
     where s.created_at >= p_start and s.created_at < p_end
       and s.status = 'completed'
       and (p_employee_id is null or s.created_by = p_employee_id)
       and (p_product_id is null or exists (
         select 1 from public.sale_items si
          where si.sale_id = s.id
            and (si.retail_product_id = p_product_id or si.recipe_id = p_product_id)
       ))
       and (p_category is null or exists (
         select 1 from public.sale_items si
          where si.sale_id = s.id
            and case when si.item_type = 'recipe' then 'replica'
                     else si.product_type_snapshot::text end = p_category
       ))
  )
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    into v_types
    from (
      select case when si.item_type = 'recipe' then 'replica'
                  else si.product_type_snapshot::text end as category,
             sum(greatest(
               0::bigint,
               si.line_total_cop
               - round(
                   s.discount_cop::numeric * si.line_total_cop
                   / greatest(s.subtotal_cop, 1)::numeric
                 )::bigint
               - case when a.operation = 'refund' then round(
                   a.amount_cop::numeric
                   * greatest(
                       0::bigint,
                       si.line_total_cop
                       - round(
                           s.discount_cop::numeric * si.line_total_cop
                           / greatest(s.subtotal_cop, 1)::numeric
                         )::bigint
                     )
                   / greatest(s.total_cop, 1)::numeric
                 )::bigint else 0 end
             ))::bigint as sales_cop,
             sum(case when coalesce(a.inventory_restored, false)
               then 0 else si.line_cost_cop end)::bigint as historical_cost_cop,
             sum(si.quantity)::numeric as units
        from public.sale_items si
        join selected_sales ss on ss.id = si.sale_id
        join public.sales s on s.id = si.sale_id
        left join public.sale_adjustments a on a.sale_id = s.id
       group by 1
       order by sum(si.line_total_cop) desc
    ) t;

  if p_compare_start is not null then
    with selected_sales as (
      select s.id, s.status, s.subtotal_cop, s.discount_cop,
             s.total_cop, s.total_cost_cop,
               a.operation as adjustment_operation,
               a.amount_cop as adjustment_amount_cop,
               a.inventory_restored,
               coalesce(sum(si.line_total_cop), 0)::bigint as matched_subtotal_cop,
               coalesce(sum(si.line_cost_cop), 0)::bigint as matched_cost_cop
          from public.sales s
          left join public.sale_adjustments a on a.sale_id = s.id
          left join public.sale_items si
          on si.sale_id = s.id
         and (p_product_id is null or
              si.retail_product_id = p_product_id or si.recipe_id = p_product_id)
         and (p_category is null or
              case when si.item_type = 'recipe' then 'replica'
                   else si.product_type_snapshot::text end = p_category)
       where s.created_at >= p_compare_start
         and s.created_at < p_compare_end
         and (p_employee_id is null or s.created_by = p_employee_id)
         and (p_product_id is null or exists (
           select 1 from public.sale_items matching_item
            where matching_item.sale_id = s.id
              and (matching_item.retail_product_id = p_product_id
                   or matching_item.recipe_id = p_product_id)
         ))
         and (p_category is null or exists (
           select 1 from public.sale_items matching_item
            where matching_item.sale_id = s.id
              and case when matching_item.item_type = 'recipe' then 'replica'
                       else matching_item.product_type_snapshot::text end = p_category
         ))
       group by s.id, a.operation, a.amount_cop, a.inventory_restored
    )
    select jsonb_build_object(
      'start', p_compare_start,
      'end', p_compare_end,
      'sales_cop', coalesce(sum(
        case
          when s.status <> 'completed' then 0
          else greatest(
            0::bigint,
            case
              when p_product_id is null and p_category is null then s.total_cop
              else s.matched_subtotal_cop
                - round(
                    s.discount_cop::numeric * s.matched_subtotal_cop
                    / greatest(s.subtotal_cop, 1)::numeric
                  )::bigint
            end
            - case when s.adjustment_operation = 'refund' then
                case
                  when p_product_id is null and p_category is null
                    then s.adjustment_amount_cop
                  else round(
                    s.adjustment_amount_cop::numeric
                    * greatest(
                        0::bigint,
                        s.matched_subtotal_cop
                        - round(
                            s.discount_cop::numeric * s.matched_subtotal_cop
                            / greatest(s.subtotal_cop, 1)::numeric
                          )::bigint
                      )
                    / greatest(s.total_cop, 1)::numeric
                  )::bigint
                end
              else 0 end
          )
        end
      ), 0)::bigint,
      'sales_cost_cop', coalesce(sum(
        case
          when s.status <> 'completed' or coalesce(s.inventory_restored, false)
            then 0
          when p_product_id is null and p_category is null then s.total_cost_cop
          else s.matched_cost_cop
        end
      ), 0)::bigint,
      'transactions', count(*) filter (
        where s.status = 'completed'
      )::bigint
    )
      into v_comparison
      from selected_sales s;
  end if;

  return jsonb_build_object(
    'summary', v_summary,
    'comparison', v_comparison,
    'timeline', v_timeline,
    'sales_by_category', v_sales_by_category,
    'sales_by_type', v_types,
    'top_products', v_top_products,
    'material_consumption', v_material_usage,
    'purchases', v_purchases,
    'expenses_by_category', v_expenses,
    'cash_movements', v_cash_movements
  );
end;
$$;

revoke all on function public.dashboard_metrics(timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.admin_operational_report(
  timestamptz, timestamptz, text, uuid, text, uuid, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.dashboard_metrics(timestamptz, timestamptz, timestamptz)
  to authenticated;
grant execute on function public.admin_operational_report(
  timestamptz, timestamptz, text, uuid, text, uuid, timestamptz, timestamptz
) to authenticated;
