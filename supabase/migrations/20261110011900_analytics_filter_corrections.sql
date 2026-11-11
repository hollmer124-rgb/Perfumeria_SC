-- Keep the existing authenticated RPC contracts while correcting the
-- product/category breakdowns to honor all filters and historical reversals.

create or replace function private.net_sale_line_amount(
  p_line_total_cop bigint,
  p_discount_cop bigint,
  p_subtotal_cop bigint,
  p_sale_total_cop bigint,
  p_adjustment_operation text,
  p_adjustment_amount_cop bigint
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select greatest(
    0::bigint,
    p_line_total_cop
      - round(
          p_discount_cop::numeric * p_line_total_cop
          / greatest(p_subtotal_cop, 1)::numeric
        )::bigint
      - case when p_adjustment_operation = 'refund' then
          round(
            p_adjustment_amount_cop::numeric
            * greatest(
                0::bigint,
                p_line_total_cop
                  - round(
                      p_discount_cop::numeric * p_line_total_cop
                      / greatest(p_subtotal_cop, 1)::numeric
                    )::bigint
              )
            / greatest(p_sale_total_cop, 1)::numeric
          )::bigint
        else 0 end
  );
$$;

revoke all on function private.net_sale_line_amount(
  bigint, bigint, bigint, bigint, text, bigint
) from public, anon, authenticated;

alter function public.dashboard_metrics(timestamptz, timestamptz, timestamptz)
  rename to dashboard_metrics_before_filter_correction;
revoke all on function public.dashboard_metrics_before_filter_correction(
  timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;

create function public.dashboard_metrics(
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
  v_result jsonb;
  v_products jsonb;
  v_admin boolean;
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not private.is_employee_or_admin() then
    raise exception 'An authenticated employee or administrator is required'
      using errcode = '42501';
  end if;

  v_admin := private.is_admin();
  v_result := public.dashboard_metrics_before_filter_correction(
    p_day_start, p_month_start, p_now
  );

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    into v_products
    from (
      select si.item_name_snapshot as name,
             case when si.item_type = 'recipe' then 'replica'
                  else si.product_type_snapshot::text end as category,
             sum(si.quantity)::numeric as units,
             sum(private.net_sale_line_amount(
               si.line_total_cop, s.discount_cop, s.subtotal_cop,
               s.total_cop, a.operation, a.amount_cop
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

  return jsonb_set(v_result, '{top_products}', v_products, true);
end;
$$;

alter function public.admin_operational_report(
  timestamptz, timestamptz, text, uuid, text, uuid, timestamptz, timestamptz
) rename to admin_operational_report_before_filter_correction;
revoke all on function public.admin_operational_report_before_filter_correction(
  timestamptz, timestamptz, text, uuid, text, uuid, timestamptz, timestamptz
) from public, anon, authenticated;

create function public.admin_operational_report(
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
  v_result jsonb;
  v_top_products jsonb;
  v_sales_by_type jsonb;
begin
  if auth.uid() is null
     or private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'Administrator access is required'
      using errcode = '42501';
  end if;

  v_result := public.admin_operational_report_before_filter_correction(
    p_start, p_end, p_bucket, p_product_id, p_category, p_employee_id,
    p_compare_start, p_compare_end
  );

  with selected_items as (
    select si.item_name_snapshot,
           case when si.item_type = 'recipe' then 'replica'
                else si.product_type_snapshot::text end as category,
           si.quantity,
           private.net_sale_line_amount(
             si.line_total_cop, s.discount_cop, s.subtotal_cop,
             s.total_cop, a.operation, a.amount_cop
           ) as sales_cop,
           case when coalesce(a.inventory_restored, false)
             then 0 else si.line_cost_cop end as historical_cost_cop
      from public.sale_items si
      join public.sales s on s.id = si.sale_id
      left join public.sale_adjustments a on a.sale_id = s.id
     where s.status = 'completed'
       and s.created_at >= p_start
       and s.created_at < p_end
       and (p_employee_id is null or s.created_by = p_employee_id)
       and (p_product_id is null
         or si.retail_product_id = p_product_id
         or si.recipe_id = p_product_id)
       and (p_category is null or
         case when si.item_type = 'recipe' then 'replica'
              else si.product_type_snapshot::text end = p_category)
  ),
  product_totals as (
    select item_name_snapshot, category,
           sum(quantity)::numeric as units,
           sum(sales_cop)::bigint as sales_cop,
           sum(historical_cost_cop)::bigint as historical_cost_cop
      from selected_items
     group by item_name_snapshot, category
  ),
  category_totals as (
    select category,
           sum(sales_cop)::bigint as sales_cop,
           sum(historical_cost_cop)::bigint as historical_cost_cop,
           sum(quantity)::numeric as units
      from selected_items
     group by category
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
      'name', t.item_name_snapshot,
      'category', t.category,
      'units', t.units,
      'sales_cop', t.sales_cop,
      'historical_cost_cop', t.historical_cost_cop
    ) order by t.sales_cop desc), '[]'::jsonb)
       from (
         select * from product_totals
         order by sales_cop desc
         limit 100
       ) t),
    (select coalesce(jsonb_agg(jsonb_build_object(
      'category', t.category,
      'sales_cop', t.sales_cop,
      'historical_cost_cop', t.historical_cost_cop,
      'units', t.units
    ) order by t.sales_cop desc), '[]'::jsonb)
       from category_totals t)
    into v_top_products, v_sales_by_type
    ;

  return jsonb_set(
    jsonb_set(v_result, '{top_products}', v_top_products, true),
    '{sales_by_type}', v_sales_by_type, true
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
