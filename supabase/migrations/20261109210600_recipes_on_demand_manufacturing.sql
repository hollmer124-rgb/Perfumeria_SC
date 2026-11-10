-- Versioned recipe management and measured, on-demand recipe manufacturing.

create policy recipe_components_select_active
  on public.recipe_components for select to authenticated
  using (
    (select private.is_employee_or_admin())
    and exists (
      select 1
        from public.recipes r
       where r.id = recipe_components.recipe_id
         and r.status = 'active'
    )
  );

create table private.recipe_manufacturing_context (
  backend_pid integer primary key,
  transaction_id bigint not null,
  actor_id uuid not null,
  context_token uuid not null
);
revoke all on table private.recipe_manufacturing_context
  from public, anon, authenticated;

create or replace function private.recipe_manufacturing_context_valid()
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and private.is_employee_or_admin()
    and exists (
      select 1
        from private.recipe_manufacturing_context c
       where c.backend_pid = pg_catalog.pg_backend_pid()
         and c.transaction_id = pg_catalog.txid_current()
         and c.actor_id = auth.uid()
         and c.context_token::text = current_setting(
           'app.recipe_manufacturing_token', true
         )
    );
$$;

create or replace function private.require_measured_recipe_manufacturing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.item_type = 'recipe'
     and exists (
       select 1
         from public.recipe_components rc
        where rc.recipe_id = new.recipe_id
          and rc.mode = 'fill_to_volume'
     )
     and not private.recipe_manufacturing_context_valid() then
    raise exception 'Recipes with fill_to_volume must be manufactured with measured consumption'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger require_measured_recipe_manufacturing
before insert on public.sale_items
for each row execute function private.require_measured_recipe_manufacturing();

create or replace function private.validate_active_recipe_bottle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'active' and (
    (select count(*)
       from public.recipe_components rc
       join public.materials m on m.id = rc.material_id
      where rc.recipe_id = new.id
        and m.category = 'bottle') <> 1
    or
    (select count(*)
       from public.recipe_components rc
       join public.materials m on m.id = rc.material_id
      where rc.recipe_id = new.id
        and m.active
        and m.category = 'bottle'
        and m.base_unit = 'unit'
        and m.size_ml = new.size_ml
        and rc.mode = 'fixed'
        and rc.quantity = 1) <> 1
  ) then
    raise exception 'An active recipe requires exactly one fixed bottle matching its presentation'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger validate_active_recipe_bottle
before insert or update on public.recipes
for each row execute function private.validate_active_recipe_bottle();

revoke all on function private.recipe_manufacturing_context_valid()
  from public, anon, authenticated;
revoke all on function private.require_measured_recipe_manufacturing()
  from public, anon, authenticated;
revoke all on function private.validate_active_recipe_bottle()
  from public, anon, authenticated;

create or replace function public.create_recipe_version(p_recipe_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_source public.recipes%rowtype;
  v_new_id uuid;
  v_version integer;
begin
  if v_actor is null
     or private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an authenticated administrator can create recipe versions'
      using errcode = '42501';
  end if;

  select r.*
    into v_source
    from public.recipes r
   where r.id = p_recipe_id;
  if not found then
    raise exception 'Recipe version not found' using errcode = 'P0002';
  end if;

  perform 1
    from public.perfumes p
   where p.id = v_source.perfume_id
   for update;
  if not found then
    raise exception 'Recipe perfume not found' using errcode = '23503';
  end if;

  select r.*
    into v_source
    from public.recipes r
   where r.id = p_recipe_id
   for update;
  if not found then
    raise exception 'Recipe version not found' using errcode = 'P0002';
  end if;

  select coalesce(max(r.version), 0) + 1
    into v_version
    from public.recipes r
   where r.perfume_id = v_source.perfume_id
     and r.size_ml = v_source.size_ml;

  insert into public.recipes (
    perfume_id, size_ml, version, status, price_cop, created_by
  )
  values (
    v_source.perfume_id, v_source.size_ml, v_version, 'draft',
    v_source.price_cop, v_actor
  )
  returning id into v_new_id;

  insert into public.recipe_components (recipe_id, material_id, mode, quantity)
  select v_new_id, rc.material_id, rc.mode, rc.quantity
    from public.recipe_components rc
   where rc.recipe_id = v_source.id;

  return v_new_id;
end;
$$;

create or replace function public.admin_save_recipe(
  p_recipe_id uuid,
  p_perfume_id uuid,
  p_size_ml integer,
  p_price_cop bigint,
  p_components jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_recipe public.recipes%rowtype;
  v_recipe_id uuid;
  v_version integer;
begin
  if v_actor is null
     or private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an authenticated administrator can manage recipes'
      using errcode = '42501';
  end if;

  if p_perfume_id is null
     or p_size_ml is null
     or p_size_ml not in (30, 50, 60, 100)
     or p_price_cop is null or p_price_cop < 0
     or p_components is null
     or jsonb_typeof(p_components) is distinct from 'array' then
    raise exception 'Recipe fields or component list are invalid'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_components) not between 1 and 50 then
    raise exception 'A recipe must have between 1 and 50 components'
      using errcode = '22023';
  end if;

  perform 1
    from public.perfumes p
   where p.id = p_perfume_id and p.active
   for update;
  if not found then
    raise exception 'An active perfume is required'
      using errcode = '23503';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_components) e(value)
     where jsonb_typeof(e.value) is distinct from 'object'
  ) then
    raise exception 'Recipe components must be JSON objects'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_components) e(value)
     where (e.value - array['material_id', 'mode', 'quantity']) <> '{}'::jsonb
        or jsonb_typeof(e.value -> 'material_id') is distinct from 'string'
        or coalesce(e.value ->> 'material_id', '') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        or jsonb_typeof(e.value -> 'mode') is distinct from 'string'
        or coalesce(e.value ->> 'mode', '') not in ('fixed', 'fill_to_volume')
        or (
          e.value ->> 'mode' = 'fixed'
          and (
            jsonb_typeof(e.value -> 'quantity') is distinct from 'number'
            or coalesce(e.value ->> 'quantity', '') !~
              '^[0-9]+([.][0-9]{1,4})?$'
            or (e.value ->> 'quantity')::numeric <= 0
          )
        )
        or (
          e.value ->> 'mode' = 'fill_to_volume'
          and e.value -> 'quantity' is distinct from 'null'::jsonb
        )
  ) then
    raise exception 'Recipe component has an invalid shape, mode, or quantity'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_components) e(value)
     group by (e.value ->> 'material_id')::uuid
    having count(*) > 1
  ) then
    raise exception 'A material may only appear once in a recipe'
      using errcode = '22023';
  end if;

  if (
    select count(*) filter (where e.value ->> 'mode' = 'fill_to_volume')
      from jsonb_array_elements(p_components) e(value)
  ) > 1 then
    raise exception 'A recipe can have at most one fill_to_volume component'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_components) e(value)
      left join public.materials m
        on m.id = (e.value ->> 'material_id')::uuid
     where m.id is null or not m.active
        or (
          e.value ->> 'mode' = 'fill_to_volume'
          and m.base_unit <> 'ml'
        )
  ) then
    raise exception 'All components must reference active materials; fill_to_volume requires ml'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_components) e(value)
      join public.materials m
        on m.id = (e.value ->> 'material_id')::uuid
     where e.value ->> 'mode' = 'fixed'
       and m.base_unit = 'ml'
    having sum((e.value ->> 'quantity')::numeric) >= p_size_ml
       and exists (
         select 1
           from jsonb_array_elements(p_components) f(value)
          where f.value ->> 'mode' = 'fill_to_volume'
       )
  ) then
    raise exception 'Fixed ml components leave no positive fill volume'
      using errcode = '23514';
  end if;

  if p_recipe_id is null then
    select coalesce(max(r.version), 0) + 1
      into v_version
      from public.recipes r
     where r.perfume_id = p_perfume_id
       and r.size_ml = p_size_ml;

    insert into public.recipes (
      perfume_id, size_ml, version, status, price_cop, created_by
    )
    values (
      p_perfume_id, p_size_ml, v_version, 'draft', p_price_cop, v_actor
    )
    returning id into v_recipe_id;
  else
    select r.*
      into v_recipe
      from public.recipes r
     where r.id = p_recipe_id
     for update;
    if not found then
      raise exception 'Recipe version not found' using errcode = 'P0002';
    end if;
    if v_recipe.status <> 'draft'
       or v_recipe.perfume_id <> p_perfume_id
       or v_recipe.size_ml <> p_size_ml then
      raise exception 'Only the matching draft recipe version can be edited'
        using errcode = '55000';
    end if;

    v_recipe_id := p_recipe_id;
    update public.recipes
       set price_cop = p_price_cop
     where id = v_recipe_id;
    delete from public.recipe_components
     where recipe_id = v_recipe_id;
  end if;

  insert into public.recipe_components (
    recipe_id, material_id, mode, quantity
  )
  select v_recipe_id,
         (e.value ->> 'material_id')::uuid,
         (e.value ->> 'mode')::public.component_mode,
         case when e.value ->> 'mode' = 'fixed'
           then (e.value ->> 'quantity')::numeric
           else null
         end
    from jsonb_array_elements(p_components) e(value);

  return v_recipe_id;
end;
$$;

create or replace function public.register_recipe_manufacture(
  p_recipe_id uuid,
  p_quantity integer,
  p_fill_consumption_ml numeric,
  p_payment_method public.payment_method,
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
  v_recipe public.recipes%rowtype;
  v_component record;
  v_sale_id uuid;
  v_sale_item_id uuid;
  v_total_cost bigint := 0;
  v_unit_cost bigint;
  v_line_cost bigint;
  v_component_cost bigint;
  v_use_qty numeric(14, 4);
  v_fixed_ml numeric := 0;
  v_unit_cost_total bigint := 0;
  v_fill_components integer;
  v_cash_session public.cash_sessions%rowtype;
  v_token uuid;
  v_affected integer;
  v_snapshot jsonb;
begin
  if v_actor is null or not private.is_employee_or_admin() then
    raise exception 'An authenticated employee or administrator is required'
      using errcode = '42501';
  end if;
  if p_recipe_id is null or p_quantity is null or p_quantity not between 1 and 999999
     or p_payment_method is null
     or p_notes is not null and length(p_notes) > 1000 then
    raise exception 'Manufacture fields are invalid'
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

  select r.*
    into v_recipe
    from public.recipes r
   where r.id = p_recipe_id and r.status = 'active'
   for share;
  if not found then
    raise exception 'An active recipe version is required'
      using errcode = 'P0002';
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
        and m.active
        and m.category = 'bottle'
        and m.base_unit = 'unit'
        and m.size_ml = v_recipe.size_ml
        and rc.mode = 'fixed'
        and rc.quantity = 1) <> 1
  ) then
    raise exception 'Recipe must include exactly one active bottle matching its presentation'
      using errcode = '23514';
  end if;

  select count(*) filter (where rc.mode = 'fill_to_volume')
    into v_fill_components
    from public.recipe_components rc
   where rc.recipe_id = v_recipe.id;
  if v_fill_components > 0 then
    select coalesce(sum(rc.quantity), 0)
      into v_fixed_ml
      from public.recipe_components rc
      join public.materials m on m.id = rc.material_id
     where rc.recipe_id = v_recipe.id
       and rc.mode = 'fixed'
       and m.base_unit = 'ml';
    if p_fill_consumption_ml is null
       or p_fill_consumption_ml <= 0
       or p_fill_consumption_ml + v_fixed_ml > v_recipe.size_ml
       or p_fill_consumption_ml::text in ('NaN', 'Infinity', '-Infinity')
       or p_fill_consumption_ml <> round(p_fill_consumption_ml, 4) then
      raise exception 'Enter actual fill in ml (up to 4 decimals) without exceeding the presentation volume'
        using errcode = '22023';
    end if;
  elsif p_fill_consumption_ml is not null then
    raise exception 'This recipe has no fill_to_volume material'
      using errcode = '22023';
  end if;

  perform m.id
    from public.materials m
    join public.recipe_components rc on rc.material_id = m.id
   where rc.recipe_id = v_recipe.id
   order by m.id
   for update of m;

  if exists (
    select 1 from public.recipe_components rc
    join public.materials m on m.id = rc.material_id
    where rc.recipe_id = v_recipe.id and not m.active
  ) then
    raise exception 'Recipe contains an inactive material'
      using errcode = '23514';
  end if;

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

  for v_component in
    select rc.material_id, rc.mode, rc.quantity, m.name, m.base_unit,
           m.avg_unit_cost_cop, m.on_hand_qty
      from public.recipe_components rc
      join public.materials m on m.id = rc.material_id
     where rc.recipe_id = v_recipe.id
     order by m.id
  loop
    v_use_qty := case
      when v_component.mode = 'fill_to_volume' then p_fill_consumption_ml
      else v_component.quantity
    end * p_quantity;
    if v_component.on_hand_qty < v_use_qty then
      raise exception 'Insufficient material stock for %', v_component.name
        using errcode = '23514';
    end if;
    v_total_cost := v_total_cost
      + round(v_use_qty * v_component.avg_unit_cost_cop)::bigint;
    v_unit_cost_total := v_unit_cost_total
      + round(
          (case
            when v_component.mode = 'fill_to_volume'
              then p_fill_consumption_ml
            else v_component.quantity
          end) * v_component.avg_unit_cost_cop
        )::bigint;
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'material_id', m.id,
        'name', m.name,
        'unit', m.base_unit,
        'mode', rc.mode,
        'quantity_per_bottle',
          case when rc.mode = 'fill_to_volume'
            then p_fill_consumption_ml
            else rc.quantity
          end,
        'unit_cost_cop', m.avg_unit_cost_cop,
        'extended_cost_cop', round(
          (case when rc.mode = 'fill_to_volume'
            then p_fill_consumption_ml
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

  insert into public.sales (
    created_by, customer_id, cash_session_id, payment_method,
    subtotal_cop, total_cop, total_cost_cop, notes
  )
  values (
    v_actor, p_customer_id, p_cash_session_id, p_payment_method,
    p_quantity * v_recipe.price_cop, p_quantity * v_recipe.price_cop,
    v_total_cost, nullif(btrim(p_notes), '')
  )
  returning id into v_sale_id;

  v_unit_cost := v_unit_cost_total;
  v_line_cost := v_total_cost;
  v_snapshot := jsonb_build_object(
    'recipe_id', v_recipe.id,
    'perfume_id', v_recipe.perfume_id,
    'perfume_name', (
      select p.name from public.perfumes p where p.id = v_recipe.perfume_id
    ),
    'size_ml', v_recipe.size_ml,
    'version', v_recipe.version,
    'price_cop', v_recipe.price_cop,
    'quantity', p_quantity,
    'unit_cost_cop', v_unit_cost,
    'line_cost_cop', v_line_cost,
    'fill_consumption_ml_per_bottle', p_fill_consumption_ml,
    'components', v_snapshot
  );

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

  insert into public.sale_items (
    sale_id, item_type, recipe_id, item_name_snapshot, size_ml_snapshot,
    recipe_version_snapshot, quantity, unit_price_cop, line_total_cop,
    unit_cost_cop, line_cost_cop, recipe_snapshot
  )
  select v_sale_id, 'recipe', v_recipe.id, p.name, v_recipe.size_ml,
         v_recipe.version, p_quantity, v_recipe.price_cop,
         p_quantity * v_recipe.price_cop, v_unit_cost, v_line_cost,
         v_snapshot
    from public.perfumes p
   where p.id = v_recipe.perfume_id and p.active
  returning id into v_sale_item_id;
  if v_sale_item_id is null then
    raise exception 'Recipe perfume is missing or inactive'
      using errcode = '23514';
  end if;

  for v_component in
    select rc.material_id, rc.mode, rc.quantity, m.name, m.base_unit,
           m.avg_unit_cost_cop
      from public.recipe_components rc
      join public.materials m on m.id = rc.material_id
     where rc.recipe_id = v_recipe.id
     order by m.id
  loop
    v_use_qty := case
      when v_component.mode = 'fill_to_volume' then p_fill_consumption_ml
      else v_component.quantity
    end * p_quantity;
    v_component_cost := round(v_use_qty * v_component.avg_unit_cost_cop)::bigint;

    update public.materials
       set on_hand_qty = on_hand_qty - v_use_qty
     where id = v_component.material_id
       and on_hand_qty >= v_use_qty;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception 'Insufficient material stock for %', v_component.name
        using errcode = '23514';
    end if;

    insert into public.sale_material_usage (
      sale_item_id, material_id, material_name_snapshot, unit_snapshot,
      quantity_used, unit_cost_cop, total_cost_cop
    )
    values (
      v_sale_item_id, v_component.material_id, v_component.name,
      v_component.base_unit, v_use_qty, v_component.avg_unit_cost_cop,
      v_component_cost
    );

    insert into public.inventory_movements (
      material_id, movement_type, sale_item_id, quantity_delta,
      unit_cost_cop, total_cost_cop, created_by
    )
    values (
      v_component.material_id, 'sale', v_sale_item_id, -v_use_qty,
      v_component.avg_unit_cost_cop, v_component_cost, v_actor
    );
  end loop;

  delete from private.recipe_manufacturing_context
   where backend_pid = pg_catalog.pg_backend_pid()
     and transaction_id = pg_catalog.txid_current()
     and actor_id = v_actor;
  perform pg_catalog.set_config('app.recipe_manufacturing_token', '', true);

  if p_payment_method = 'cash' then
    insert into public.cash_movements (
      cash_session_id, movement_type, sale_id, amount_cop, created_by,
      description
    )
    values (
      p_cash_session_id, 'sale_in', v_sale_id,
      p_quantity * v_recipe.price_cop, v_actor,
      'Fabricación bajo pedido ' || v_sale_id::text
    );

    update public.cash_sessions
       set expected_cop = expected_cop + p_quantity * v_recipe.price_cop
     where id = p_cash_session_id
       and status = 'open'
       and opened_by = v_actor;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception 'Cash session changed during manufacture'
        using errcode = '40001';
    end if;
  end if;

  return v_sale_id;
end;
$$;

revoke all on function public.admin_save_recipe(uuid, uuid, integer, bigint, jsonb)
  from public, anon;
revoke all on function public.register_recipe_manufacture(
  uuid, integer, numeric, public.payment_method, uuid, uuid, text
) from public, anon;
grant execute on function public.admin_save_recipe(
  uuid, uuid, integer, bigint, jsonb
) to authenticated;
grant execute on function public.register_recipe_manufacture(
  uuid, integer, numeric, public.payment_method, uuid, uuid, text
) to authenticated;
