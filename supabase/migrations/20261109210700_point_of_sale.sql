-- Idempotent point of sale, configurable supported payment methods, and
-- administrator-authorized full-sale reversals.

alter table public.sales
  add column discount_cop bigint not null default 0
    check (discount_cop >= 0),
  add column idempotency_key uuid,
  add column request_fingerprint text;

do $$
declare
  v_constraint name;
begin
  for v_constraint in
    select c.conname
      from pg_catalog.pg_constraint c
     where c.conrelid = 'public.sales'::regclass
       and c.contype = 'c'
       and pg_catalog.pg_get_constraintdef(c.oid) ilike '%subtotal_cop%total_cop%'
  loop
    execute pg_catalog.format(
      'alter table public.sales drop constraint %I',
      v_constraint
    );
  end loop;
end;
$$;

alter table public.sales
  add constraint sales_totals_discount_check
  check (
    discount_cop <= subtotal_cop
    and total_cop = subtotal_cop - discount_cop
  ),
  add constraint sales_idempotency_pair_check
  check (
    (idempotency_key is null and request_fingerprint is null)
    or (
      idempotency_key is not null
      and request_fingerprint is not null
      and length(request_fingerprint) = 32
    )
  );
create unique index sales_idempotency_key_idx
  on public.sales (idempotency_key);

create table public.payment_method_settings (
  method public.payment_method primary key,
  label text not null check (length(btrim(label)) between 1 and 40),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.payment_method_settings enable row level security;
create policy payment_method_settings_authenticated_select
  on public.payment_method_settings for select to authenticated
  using ((select private.is_employee_or_admin()));
create policy payment_method_settings_admin_all
  on public.payment_method_settings for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
grant select on public.payment_method_settings to authenticated;
revoke insert, update, delete on public.payment_method_settings
  from authenticated;

insert into public.payment_method_settings (method, label, enabled)
values
  ('cash', 'Efectivo', true),
  ('transfer', 'Transferencia', true),
  ('card', 'Tarjeta', true),
  ('other', 'Otro', true)
on conflict (method) do nothing;

create trigger audit_payment_method_settings
after insert or update or delete on public.payment_method_settings
for each row execute function private.audit_row_change();

create table public.sale_adjustments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null unique references public.sales (id) on delete restrict,
  operation text not null check (operation in ('void', 'refund')),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  amount_cop bigint not null check (amount_cop >= 0),
  inventory_restored boolean not null default false,
  refund_payment_method public.payment_method,
  cash_session_id uuid references public.cash_sessions (id) on delete restrict,
  authorized_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  check (
    refund_payment_method is not null
    and (
      (refund_payment_method = 'cash' and cash_session_id is not null)
      or (refund_payment_method <> 'cash' and cash_session_id is null)
    )
  )
);
alter table public.cash_movements
  add column sale_adjustment_id uuid
    references public.sale_adjustments (id) on delete restrict,
  add constraint cash_movement_adjustment_check
    check (
      sale_adjustment_id is null
      or (
        movement_type = 'withdrawal'
        and sale_id is null
        and expense_id is null
      )
    );
create unique index cash_movements_sale_adjustment_idx
  on public.cash_movements (sale_adjustment_id)
  where sale_adjustment_id is not null;
alter table public.sale_adjustments enable row level security;
create policy sale_adjustments_admin_select
  on public.sale_adjustments for select to authenticated
  using ((select private.is_admin()));
create policy sale_adjustments_select_own
  on public.sale_adjustments for select to authenticated
  using (
    exists (
      select 1
        from public.sales s
       where s.id = sale_id
         and s.created_by = (select auth.uid())
         and (select private.is_employee_or_admin())
    )
  );
grant select on public.sale_adjustments to authenticated;
revoke insert, update, delete on public.sale_adjustments
  from authenticated;

alter table public.inventory_movements
  add column sale_adjustment_id uuid
    references public.sale_adjustments (id) on delete restrict;
create unique index inventory_movements_adjustment_material_idx
  on public.inventory_movements (sale_adjustment_id, material_id)
  where sale_adjustment_id is not null and material_id is not null;
create unique index inventory_movements_adjustment_product_idx
  on public.inventory_movements (sale_adjustment_id, retail_product_id)
  where sale_adjustment_id is not null and retail_product_id is not null;

create trigger audit_sale_adjustments
after insert or update or delete on public.sale_adjustments
for each row execute function private.audit_row_change();
revoke all on function public.register_sale(
  jsonb, public.payment_method, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.register_recipe_manufacture(
  uuid, integer, numeric, public.payment_method, uuid, uuid, text
) from public, anon, authenticated;

create or replace function public.admin_configure_payment_method(
  p_method public.payment_method,
  p_label text,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an authenticated administrator can configure payment methods'
      using errcode = '42501';
  end if;
  if p_method is null
     or p_label is null
     or length(btrim(p_label)) not between 1 and 40
     or p_enabled is null then
    raise exception 'Payment method configuration is invalid'
      using errcode = '22023';
  end if;

  insert into public.payment_method_settings (method, label, enabled, updated_at)
  values (p_method, btrim(p_label), p_enabled, now())
  on conflict (method) do update
    set label = excluded.label,
        enabled = excluded.enabled,
        updated_at = now();

  if not exists (
    select 1 from public.payment_method_settings where enabled
  ) then
    raise exception 'At least one payment method must remain enabled'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.register_pos_sale(
  p_items jsonb,
  p_payment_method public.payment_method,
  p_idempotency_key uuid,
  p_discount_cop bigint default 0,
  p_customer_id uuid default null,
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
  v_role public.app_role;
  v_request_fingerprint text;
  v_existing public.sales%rowtype;
  v_sale_id uuid;
  v_sale_item_id uuid;
  v_line record;
  v_product public.retail_products%rowtype;
  v_recipe public.recipes%rowtype;
  v_component record;
  v_cash_session public.cash_sessions%rowtype;
  v_line_total bigint;
  v_line_cost bigint;
  v_unit_cost bigint;
  v_subtotal bigint := 0;
  v_total_cost bigint := 0;
  v_cost_per_unit bigint;
  v_line_fill numeric(14, 4);
  v_item_name text;
  v_fixed_ml numeric;
  v_material_usage numeric(14, 4);
  v_component_cost bigint;
  v_affected integer;
  v_fill_count integer;
  v_token uuid;
  v_snapshot jsonb;
begin
  v_role := private.current_role();
  if v_actor is null or v_role is null or v_role not in (
    'admin'::public.app_role, 'employee'::public.app_role
  ) then
    raise exception 'An authenticated employee or administrator is required'
      using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'An idempotency key is required'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_idempotency_key::text)
  );

  v_request_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'items', p_items,
      'payment_method', p_payment_method,
      'discount_cop', p_discount_cop,
      'customer_id', p_customer_id,
      'cash_session_id', p_cash_session_id,
      'notes', nullif(btrim(p_notes), '')
    )::text
  );
  select s.*
    into v_existing
    from public.sales s
   where s.idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_existing.created_by <> v_actor
       or v_existing.request_fingerprint <> v_request_fingerprint then
      raise exception 'Idempotency key was already used for a different request'
        using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Sale items must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Sale must contain between 1 and 100 lines'
      using errcode = '22023';
  end if;
  if p_payment_method is null then
    raise exception 'Payment method is unavailable'
      using errcode = '22023';
  end if;
  perform 1
    from public.payment_method_settings pms
   where pms.method = p_payment_method
     and pms.enabled
   for share;
  if not found then
    raise exception 'Payment method is unavailable'
      using errcode = '22023';
  end if;
  if p_discount_cop is null or p_discount_cop < 0
     or p_notes is not null and length(p_notes) > 1000 then
    raise exception 'Discount or sale notes are invalid'
      using errcode = '22023';
  end if;
  if v_role <> 'admin'::public.app_role and p_discount_cop <> 0 then
    raise exception 'Only an administrator can apply a sale discount'
      using errcode = '42501';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_items) e(value)
     where jsonb_typeof(e.value) is distinct from 'object'
  ) then
    raise exception 'Sale line must be a JSON object'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_items) e(value)
     where (e.value - array[
         'kind', 'id', 'quantity', 'fill_consumption_ml'
       ]) <> '{}'::jsonb
        or jsonb_typeof(e.value -> 'kind') is distinct from 'string'
        or coalesce(e.value ->> 'kind', '') not in ('retail_product', 'recipe')
        or jsonb_typeof(e.value -> 'id') is distinct from 'string'
        or coalesce(e.value ->> 'id', '') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        or jsonb_typeof(e.value -> 'quantity') is distinct from 'number'
        or coalesce(e.value ->> 'quantity', '') !~ '^[0-9]+$'
        or (e.value ->> 'quantity')::numeric not between 1 and 999999
        or (
          e.value -> 'fill_consumption_ml' is not null
          and e.value -> 'fill_consumption_ml' <> 'null'::jsonb
          and (
            jsonb_typeof(e.value -> 'fill_consumption_ml')
              is distinct from 'number'
            or coalesce(e.value ->> 'fill_consumption_ml', '') !~
              '^[0-9]+([.][0-9]{1,4})?$'
          )
        )
  ) then
    raise exception 'Sale line has an invalid shape, id, quantity, or fill measurement'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_items) e(value)
     where e.value ->> 'kind' = 'retail_product'
       and e.value -> 'fill_consumption_ml' is not null
       and e.value -> 'fill_consumption_ml' <> 'null'::jsonb
  ) then
    raise exception 'Retail product lines cannot include a fill measurement'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_items) e(value)
     group by e.value ->> 'kind', (e.value ->> 'id')::uuid
    having count(*) > 1
  ) then
    raise exception 'Each item may appear only once in the cart'
      using errcode = '22023';
  end if;
  if p_payment_method = 'cash' and p_cash_session_id is null then
    raise exception 'Cash sales require an open cash session'
      using errcode = '22023';
  elsif p_payment_method <> 'cash' and p_cash_session_id is not null then
    raise exception 'A cash session may only be attached to a cash sale'
      using errcode = '22023';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers c where c.id = p_customer_id
  ) then
    raise exception 'Customer not found' using errcode = '23503';
  end if;

  -- Stable lock ordering serializes competing stock consumption.
  perform rp.id
    from public.retail_products rp
    join jsonb_array_elements(p_items) e(value)
      on e.value ->> 'kind' = 'retail_product'
     and rp.id = (e.value ->> 'id')::uuid
   order by rp.id
   for update of rp;
  perform r.id
    from public.recipes r
    join jsonb_array_elements(p_items) e(value)
      on e.value ->> 'kind' = 'recipe'
     and r.id = (e.value ->> 'id')::uuid
   order by r.id
   for share of r;
  perform m.id
    from public.materials m
   where exists (
     select 1
       from public.recipe_components rc
       join jsonb_array_elements(p_items) e(value)
         on e.value ->> 'kind' = 'recipe'
        and rc.recipe_id = (e.value ->> 'id')::uuid
      where rc.material_id = m.id
   )
   order by m.id
   for update of m;

  if p_payment_method = 'cash' then
    select cs.*
      into v_cash_session
      from public.cash_sessions cs
     where cs.id = p_cash_session_id
       and cs.status = 'open'
       and cs.opened_by = v_actor
     for update;
    if not found then
      raise exception 'Open cash session not found for the current user'
        using errcode = '42501';
    end if;
  end if;

  for v_line in
    select e.value ->> 'kind' as kind,
           (e.value ->> 'id')::uuid as item_id,
           (e.value ->> 'quantity')::integer as quantity,
           case
             when e.value -> 'fill_consumption_ml' is null
               or e.value -> 'fill_consumption_ml' = 'null'::jsonb
             then null
             else (e.value ->> 'fill_consumption_ml')::numeric(14, 4)
           end as fill_consumption_ml,
           e.ordinality
      from jsonb_array_elements(p_items)
        with ordinality as e(value, ordinality)
     order by e.ordinality
  loop
    if v_line.kind = 'retail_product' then
      select rp.*
        into v_product
        from public.retail_products rp
       where rp.id = v_line.item_id and rp.active;
      if not found then
        raise exception 'An active retail product was not found'
          using errcode = 'P0002';
      end if;
      if v_product.stock_qty < v_line.quantity then
        raise exception 'Insufficient stock for retail product %', v_product.name
          using errcode = '23514';
      end if;
      v_line_total := v_line.quantity * v_product.price_cop;
      v_line_cost := v_line.quantity * v_product.avg_unit_cost_cop;
      v_subtotal := v_subtotal + v_line_total;
      v_total_cost := v_total_cost + v_line_cost;
    else
      select r.*
        into v_recipe
        from public.recipes r
       where r.id = v_line.item_id and r.status = 'active';
      if not found then
        raise exception 'An active recipe version was not found'
          using errcode = 'P0002';
      end if;
      if not exists (
        select 1 from public.perfumes p
         where p.id = v_recipe.perfume_id and p.active
      ) then
        raise exception 'Recipe perfume is missing or inactive'
          using errcode = '23514';
      end if;
      if (
        (select count(*)
           from public.recipe_components rc
           join public.materials m on m.id = rc.material_id
          where rc.recipe_id = v_recipe.id
            and m.category = 'bottle') <> 1
        or
        (select count(*)
           from public.recipe_components rc
           join public.materials m on m.id = rc.material_id
          where rc.recipe_id = v_recipe.id
            and m.active and m.category = 'bottle'
            and m.base_unit = 'unit'
            and m.size_ml = v_recipe.size_ml
            and rc.mode = 'fixed' and rc.quantity = 1) <> 1
      ) then
        raise exception 'Recipe must include exactly one matching atomizer bottle'
          using errcode = '23514';
      end if;

      select count(*) filter (where rc.mode = 'fill_to_volume'),
             coalesce(sum(rc.quantity) filter (
               where rc.mode = 'fixed' and m.base_unit = 'ml'
             ), 0)
        into v_fill_count, v_fixed_ml
        from public.recipe_components rc
        join public.materials m on m.id = rc.material_id
       where rc.recipe_id = v_recipe.id;
      if v_fill_count > 0 then
        if v_line.fill_consumption_ml is null
           or v_line.fill_consumption_ml <= 0
           or v_line.fill_consumption_ml + v_fixed_ml > v_recipe.size_ml then
          raise exception 'The real fill consumption must be measured and fit the presentation volume'
            using errcode = '22023';
        end if;
      elsif v_line.fill_consumption_ml is not null then
        raise exception 'This recipe does not contain a variable fill component'
          using errcode = '22023';
      end if;

      if exists (
        select 1 from public.recipe_components rc
        join public.materials m on m.id = rc.material_id
        where rc.recipe_id = v_recipe.id
          and (not m.active or m.on_hand_qty < (
            case when rc.mode = 'fill_to_volume'
              then v_line.fill_consumption_ml
              else rc.quantity
            end
          ) * v_line.quantity)
      ) then
        raise exception 'Insufficient material inventory for recipe %', v_recipe.id
          using errcode = '23514';
      end if;

      select coalesce(
        sum(round(
          (case when rc.mode = 'fill_to_volume'
            then v_line.fill_consumption_ml
            else rc.quantity
          end) * m.avg_unit_cost_cop
        )::bigint),
        0
      )
        into v_cost_per_unit
        from public.recipe_components rc
        join public.materials m on m.id = rc.material_id
       where rc.recipe_id = v_recipe.id;
      v_line_total := v_line.quantity * v_recipe.price_cop;
      select coalesce(
        sum(round(
          (case when rc.mode = 'fill_to_volume'
            then v_line.fill_consumption_ml
            else rc.quantity
          end) * v_line.quantity * m.avg_unit_cost_cop
        )::bigint),
        0
      )
        into v_line_cost
        from public.recipe_components rc
        join public.materials m on m.id = rc.material_id
       where rc.recipe_id = v_recipe.id;
      v_subtotal := v_subtotal + v_line_total;
      v_total_cost := v_total_cost + v_line_cost;
    end if;
  end loop;

  if p_discount_cop > v_subtotal then
    raise exception 'Discount cannot exceed the sale subtotal'
      using errcode = '22023';
  end if;

  v_request_fingerprint := pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'items', p_items,
      'payment_method', p_payment_method,
      'discount_cop', p_discount_cop,
      'customer_id', p_customer_id,
      'cash_session_id', p_cash_session_id,
      'notes', nullif(btrim(p_notes), '')
    )::text
  );

  insert into public.sales (
    created_by, customer_id, cash_session_id, payment_method,
    subtotal_cop, discount_cop, total_cop, total_cost_cop, notes,
    idempotency_key, request_fingerprint
  )
  values (
    v_actor, p_customer_id, p_cash_session_id, p_payment_method,
    v_subtotal, p_discount_cop, v_subtotal - p_discount_cop,
    v_total_cost, nullif(btrim(p_notes), ''),
    p_idempotency_key, v_request_fingerprint
  )
  on conflict (idempotency_key) do nothing
  returning id into v_sale_id;
  if v_sale_id is null then
    select s.*
      into v_existing
      from public.sales s
     where s.idempotency_key = p_idempotency_key
     for update;
    if not found
       or v_existing.created_by <> v_actor
       or v_existing.request_fingerprint <> v_request_fingerprint then
      raise exception 'Idempotency key was already used for a different request'
        using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_items) e(value)
     where e.value ->> 'kind' = 'recipe'
       and exists (
         select 1
           from public.recipe_components rc
          where rc.recipe_id = (e.value ->> 'id')::uuid
            and rc.mode = 'fill_to_volume'
       )
  ) then
    v_token := pg_catalog.gen_random_uuid();
    insert into private.recipe_manufacturing_context (
      backend_pid, transaction_id, actor_id, context_token
    )
    values (
      pg_catalog.pg_backend_pid(), pg_catalog.txid_current(), v_actor, v_token
    );
    perform pg_catalog.set_config(
      'app.recipe_manufacturing_token', v_token::text, true
    );
  end if;

  for v_line in
    select e.value ->> 'kind' as kind,
           (e.value ->> 'id')::uuid as item_id,
           (e.value ->> 'quantity')::integer as quantity,
           case
             when e.value -> 'fill_consumption_ml' is null
               or e.value -> 'fill_consumption_ml' = 'null'::jsonb
             then null
             else (e.value ->> 'fill_consumption_ml')::numeric(14, 4)
           end as fill_consumption_ml,
           e.ordinality
      from jsonb_array_elements(p_items)
        with ordinality as e(value, ordinality)
     order by e.ordinality
  loop
    if v_line.kind = 'retail_product' then
      select rp.*
        into v_product
        from public.retail_products rp
       where rp.id = v_line.item_id;
      v_unit_cost := v_product.avg_unit_cost_cop;
      v_line_total := v_line.quantity * v_product.price_cop;
      v_line_cost := v_line.quantity * v_unit_cost;

      insert into public.sale_items (
        sale_id, item_type, retail_product_id, item_name_snapshot,
        product_type_snapshot, quantity, unit_price_cop, line_total_cop,
        unit_cost_cop, line_cost_cop
      )
      values (
        v_sale_id, 'retail_product', v_product.id, v_product.name,
        v_product.product_type, v_line.quantity, v_product.price_cop,
        v_line_total, v_unit_cost, v_line_cost
      )
      returning id into v_sale_item_id;

      update public.retail_products
         set stock_qty = stock_qty - v_line.quantity
       where id = v_product.id and stock_qty >= v_line.quantity;
      get diagnostics v_affected = row_count;
      if v_affected <> 1 then
        raise exception 'Retail stock changed during checkout'
          using errcode = '40001';
      end if;

      insert into public.inventory_movements (
        retail_product_id, movement_type, sale_item_id, quantity_delta,
        unit_cost_cop, total_cost_cop, created_by
      )
      values (
        v_product.id, 'sale', v_sale_item_id, -v_line.quantity,
        v_unit_cost, v_line_cost, v_actor
      );
    else
      select r.*
        into v_recipe
        from public.recipes r
       where r.id = v_line.item_id and r.status = 'active';
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'material_id', m.id,
            'name', m.name,
            'unit', m.base_unit,
            'mode', rc.mode,
            'quantity_per_bottle',
              case when rc.mode = 'fill_to_volume'
                then v_line.fill_consumption_ml
                else rc.quantity
              end,
            'unit_cost_cop', m.avg_unit_cost_cop,
            'extended_cost_cop', round(
              (case when rc.mode = 'fill_to_volume'
                then v_line.fill_consumption_ml
                else rc.quantity
              end) * m.avg_unit_cost_cop
            )::bigint
          ) order by rc.id
        ),
        '[]'::jsonb
      )
        into v_snapshot
        from public.recipe_components rc
        join public.materials m on m.id = rc.material_id
       where rc.recipe_id = v_recipe.id;

      select p.name
        into strict v_item_name
        from public.perfumes p
       where p.id = v_recipe.perfume_id;

      select coalesce(
        sum(round(
          (case when rc.mode = 'fill_to_volume'
            then v_line.fill_consumption_ml
            else rc.quantity
          end) * m.avg_unit_cost_cop
        )::bigint),
        0
      )
        into v_cost_per_unit
        from public.recipe_components rc
        join public.materials m on m.id = rc.material_id
       where rc.recipe_id = v_recipe.id;
      select coalesce(
        sum(round(
          (case when rc.mode = 'fill_to_volume'
            then v_line.fill_consumption_ml
            else rc.quantity
          end) * v_line.quantity * m.avg_unit_cost_cop
        )::bigint),
        0
      )
        into v_line_cost
        from public.recipe_components rc
        join public.materials m on m.id = rc.material_id
       where rc.recipe_id = v_recipe.id;
      v_line_total := v_line.quantity * v_recipe.price_cop;
      v_snapshot := pg_catalog.jsonb_build_object(
        'recipe_id', v_recipe.id,
        'perfume_id', v_recipe.perfume_id,
        'perfume_name', v_item_name,
        'size_ml', v_recipe.size_ml,
        'version', v_recipe.version,
        'price_cop', v_recipe.price_cop,
        'quantity', v_line.quantity,
        'unit_cost_cop', v_cost_per_unit,
        'line_cost_cop', v_line_cost,
        'fill_consumption_ml_per_bottle', v_line.fill_consumption_ml,
        'components', v_snapshot
      );

      insert into public.sale_items (
        sale_id, item_type, recipe_id, item_name_snapshot, size_ml_snapshot,
        recipe_version_snapshot, quantity, unit_price_cop, line_total_cop,
        unit_cost_cop, line_cost_cop, recipe_snapshot
      )
      values (
        v_sale_id, 'recipe', v_recipe.id,
        v_item_name || ' · ' || v_recipe.size_ml::text || ' ml',
        v_recipe.size_ml, v_recipe.version, v_line.quantity,
        v_recipe.price_cop, v_line_total, v_cost_per_unit, v_line_cost,
        v_snapshot
      )
      returning id into v_sale_item_id;

      for v_component in
        select rc.material_id, rc.mode, rc.quantity, m.name, m.base_unit,
               m.avg_unit_cost_cop
          from public.recipe_components rc
          join public.materials m on m.id = rc.material_id
         where rc.recipe_id = v_recipe.id
         order by m.id
      loop
        v_material_usage := (
          case when v_component.mode = 'fill_to_volume'
            then v_line.fill_consumption_ml
            else v_component.quantity
          end
        ) * v_line.quantity;
        v_component_cost := round(
          v_material_usage * v_component.avg_unit_cost_cop
        )::bigint;
        update public.materials
           set on_hand_qty = on_hand_qty - v_material_usage
         where id = v_component.material_id
           and on_hand_qty >= v_material_usage;
        get diagnostics v_affected = row_count;
        if v_affected <> 1 then
          raise exception 'Material stock changed during checkout: %', v_component.name
            using errcode = '40001';
        end if;

        insert into public.sale_material_usage (
          sale_item_id, material_id, material_name_snapshot, unit_snapshot,
          quantity_used, unit_cost_cop, total_cost_cop
        )
        values (
          v_sale_item_id, v_component.material_id, v_component.name,
          v_component.base_unit, v_material_usage,
          v_component.avg_unit_cost_cop, v_component_cost
        );
        insert into public.inventory_movements (
          material_id, movement_type, sale_item_id, quantity_delta,
          unit_cost_cop, total_cost_cop, created_by
        )
        values (
          v_component.material_id, 'sale', v_sale_item_id, -v_material_usage,
          v_component.avg_unit_cost_cop, v_component_cost, v_actor
        );
      end loop;
    end if;
  end loop;

  delete from private.recipe_manufacturing_context
   where backend_pid = pg_catalog.pg_backend_pid()
     and transaction_id = pg_catalog.txid_current()
     and actor_id = v_actor;
  perform pg_catalog.set_config('app.recipe_manufacturing_token', '', true);

  if p_payment_method = 'cash' and v_subtotal > p_discount_cop then
    insert into public.cash_movements (
      cash_session_id, movement_type, sale_id, amount_cop, created_by,
      description
    )
    values (
      p_cash_session_id, 'sale_in', v_sale_id,
      v_subtotal - p_discount_cop, v_actor,
      'Venta ' || v_sale_id::text
    );
    update public.cash_sessions
       set expected_cop = expected_cop + v_subtotal - p_discount_cop
     where id = p_cash_session_id and status = 'open' and opened_by = v_actor;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception 'Cash session changed during checkout'
        using errcode = '40001';
    end if;
  end if;

  return v_sale_id;
end;
$$;

create or replace function public.admin_reverse_sale(
  p_sale_id uuid,
  p_operation text,
  p_reason text,
  p_restore_inventory boolean,
  p_refund_payment_method public.payment_method default null,
  p_cash_session_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_sale public.sales%rowtype;
  v_adjustment_id uuid;
  v_item record;
  v_usage record;
  v_session public.cash_sessions%rowtype;
  v_affected integer;
begin
  if v_actor is null
     or private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an authenticated administrator can reverse a sale'
      using errcode = '42501';
  end if;
  if p_sale_id is null
     or p_operation not in ('void', 'refund')
     or p_reason is null or length(btrim(p_reason)) not between 3 and 500
     or p_restore_inventory is null then
    raise exception 'Sale reversal fields are invalid'
      using errcode = '22023';
  end if;

  select s.*
    into v_sale
    from public.sales s
   where s.id = p_sale_id
   for update;
  if not found then
    raise exception 'Sale not found' using errcode = 'P0002';
  end if;
  if v_sale.status <> 'completed' then
    raise exception 'Only a completed sale can be reversed'
      using errcode = '55000';
  end if;

  if p_refund_payment_method is null then
    raise exception 'Select a refund method'
      using errcode = '22023';
  end if;
  if p_refund_payment_method = 'cash' and p_cash_session_id is null then
    raise exception 'Cash reversals require an open administrator cash session'
      using errcode = '22023';
  elsif p_refund_payment_method <> 'cash' and p_cash_session_id is not null then
    raise exception 'A cash session only applies to cash reversals'
      using errcode = '22023';
  end if;
  if p_restore_inventory then
    perform rp.id
      from public.retail_products rp
      join public.sale_items si on si.retail_product_id = rp.id
     where si.sale_id = v_sale.id
     order by rp.id
     for update of rp;
    perform m.id
      from public.materials m
      join public.sale_material_usage u on u.material_id = m.id
      join public.sale_items si on si.id = u.sale_item_id
     where si.sale_id = v_sale.id
     order by m.id
     for update of m;
  end if;

  if p_refund_payment_method = 'cash' then
    select cs.*
      into v_session
      from public.cash_sessions cs
     where cs.id = p_cash_session_id
       and cs.status = 'open'
       and cs.opened_by = v_actor
     for update;
    if not found then
      raise exception 'Open cash session not found for the administrator'
        using errcode = '42501';
    end if;
  end if;

  insert into public.sale_adjustments (
    sale_id, operation, reason, amount_cop, inventory_restored,
    refund_payment_method, cash_session_id, authorized_by
  )
  values (
    v_sale.id, p_operation, btrim(p_reason),
    v_sale.total_cop,
    p_restore_inventory,
    p_refund_payment_method,
    p_cash_session_id,
    v_actor
  )
  returning id into v_adjustment_id;

  if p_restore_inventory then
    for v_item in
      select si.id, si.retail_product_id, si.item_type, si.quantity,
             si.unit_cost_cop, si.line_cost_cop
        from public.sale_items si
       where si.sale_id = v_sale.id
       order by si.id
    loop
      if v_item.retail_product_id is not null then
        update public.retail_products
           set avg_unit_cost_cop = case
                 when stock_qty + v_item.quantity > 0 then
                   round(
                     (
                       stock_qty * avg_unit_cost_cop
                       + v_item.line_cost_cop
                     ) / (stock_qty + v_item.quantity)
                   )::bigint
                 else avg_unit_cost_cop
               end,
               stock_qty = stock_qty + v_item.quantity
         where id = v_item.retail_product_id;
        insert into public.inventory_movements (
          retail_product_id, movement_type, quantity_delta,
          unit_cost_cop, total_cost_cop, sale_adjustment_id, created_by
        )
        values (
          v_item.retail_product_id, 'reversal', v_item.quantity,
          v_item.unit_cost_cop, v_item.line_cost_cop,
          v_adjustment_id, v_actor
        );
      end if;
    end loop;

    for v_usage in
      select u.material_id,
             sum(u.quantity_used) as quantity_used,
             round(
               sum(u.total_cost_cop)::numeric / sum(u.quantity_used)
             )::bigint as unit_cost_cop,
             sum(u.total_cost_cop)::bigint as total_cost_cop
        from public.sale_material_usage u
        join public.sale_items si on si.id = u.sale_item_id
       where si.sale_id = v_sale.id
       group by u.material_id
       order by u.material_id
    loop
      update public.materials
         set avg_unit_cost_cop = case
               when on_hand_qty + v_usage.quantity_used > 0 then
                 round(
                   (
                     on_hand_qty * avg_unit_cost_cop
                     + v_usage.total_cost_cop
                   ) / (on_hand_qty + v_usage.quantity_used)
                 )::bigint
               else avg_unit_cost_cop
             end,
             on_hand_qty = on_hand_qty + v_usage.quantity_used
       where id = v_usage.material_id;
      insert into public.inventory_movements (
        material_id, movement_type, quantity_delta,
        unit_cost_cop, total_cost_cop, sale_adjustment_id, created_by
      )
      values (
        v_usage.material_id, 'reversal', v_usage.quantity_used,
        v_usage.unit_cost_cop, v_usage.total_cost_cop,
        v_adjustment_id, v_actor
      );
    end loop;
  end if;

  update public.sales
     set status = 'voided'
   where id = v_sale.id and status = 'completed';
  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception 'Sale status changed during reversal'
      using errcode = '40001';
  end if;

  if p_refund_payment_method = 'cash'
     and v_sale.total_cop > 0 then
    insert into public.cash_movements (
      cash_session_id, movement_type, amount_cop, sale_adjustment_id,
      created_by, description
    )
    values (
      p_cash_session_id, 'withdrawal', v_sale.total_cop, v_adjustment_id,
      v_actor,
      'Devolución de venta ' || v_sale.sale_number::text
    );
    update public.cash_sessions
       set expected_cop = expected_cop - v_sale.total_cop
     where id = p_cash_session_id
       and status = 'open'
       and opened_by = v_actor
       and expected_cop >= v_sale.total_cop;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception 'Cash refund exceeds available cash in the open session'
        using errcode = '23514';
    end if;
  end if;

  return v_adjustment_id;
end;
$$;

revoke all on function public.admin_configure_payment_method(
  public.payment_method, text, boolean
) from public, anon;
revoke all on function public.register_pos_sale(
  jsonb, public.payment_method, uuid, bigint, uuid, uuid, text
) from public, anon;
revoke all on function public.admin_reverse_sale(
  uuid, text, text, boolean, public.payment_method, uuid
) from public, anon;
grant execute on function public.admin_configure_payment_method(
  public.payment_method, text, boolean
) to authenticated;
grant execute on function public.register_pos_sale(
  jsonb, public.payment_method, uuid, bigint, uuid, uuid, text
) to authenticated;
grant execute on function public.admin_reverse_sale(
  uuid, text, text, boolean, public.payment_method, uuid
) to authenticated;

grant select (
  id, sale_number, created_by, customer_id, cash_session_id, status,
  payment_method, subtotal_cop, discount_cop, total_cop, notes,
  created_at, updated_at
) on public.sales to authenticated;
revoke delete on public.sales from authenticated;
revoke delete on public.sale_items from authenticated;
