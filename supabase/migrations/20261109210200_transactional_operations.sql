-- Migration 20261109210200: transactional operations with validated callers.

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.app_role;
  v_old jsonb;
  v_new jsonb;
  v_record jsonb;
begin
  if v_actor is null then
    if session_user not in ('postgres', 'supabase_admin') then
      raise exception 'An authenticated actor is required for audited changes'
        using errcode = '42501';
    end if;
  else
    v_role := private.current_role();
    if v_role is null then
      raise exception 'An active profile is required for audited changes'
        using errcode = '42501';
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new);
  end if;
  v_record := coalesce(v_new, v_old);

  insert into public.audit_logs (
    actor_id, action, table_name, record_id, old_data, new_data
  )
  values (
    v_actor,
    tg_op,
    tg_table_name,
    coalesce(v_record ->> 'id', v_record ->> 'sale_number'),
    v_old,
    v_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function private.validate_recipe_component()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_recipe_id uuid;
  v_status public.recipe_status;
  v_unit public.material_unit;
  v_material_active boolean;
begin
  if tg_op = 'DELETE' then
    v_recipe_id := old.recipe_id;
  else
    v_recipe_id := new.recipe_id;
  end if;

  select r.status
    into v_status
    from public.recipes as r
   where r.id = v_recipe_id
   for update;

  if not found then
    if tg_op = 'DELETE' then
      return old;
    end if;
    raise exception 'Recipe does not exist' using errcode = '23503';
  end if;

  if v_status <> 'draft' then
    raise exception 'Only draft recipe versions can be edited'
      using errcode = '55000';
  end if;

  if tg_op <> 'DELETE' then
    select m.base_unit, m.active
      into v_unit, v_material_active
      from public.materials as m
     where m.id = new.material_id
     for share;
    if not found then
      raise exception 'Recipe component material must exist'
        using errcode = '23503';
    end if;
    if not v_material_active then
      raise exception 'Recipe component material must be active'
        using errcode = '23514';
    end if;
    if new.mode = 'fill_to_volume' and v_unit <> 'ml' then
      raise exception 'fill_to_volume components must use an ml material'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function private.validate_recipe_activation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_component_count bigint;
  v_inactive_component_count bigint;
  v_invalid_fill_count bigint;
  v_fixed_ml numeric;
  v_perfume_active boolean;
  v_check_components boolean := false;
begin
  if tg_op = 'UPDATE' and old.status = 'active' then
    if new.perfume_id is distinct from old.perfume_id
      or new.size_ml is distinct from old.size_ml
      or new.version is distinct from old.version
      or new.price_cop is distinct from old.price_cop then
      raise exception 'Active recipe versions are immutable; create a draft version'
        using errcode = '55000';
    end if;
    if new.status is distinct from old.status and new.status <> 'archived' then
      raise exception 'An active recipe can only be archived'
        using errcode = '55000';
    end if;
  end if;

  if new.status = 'active' then
    if tg_op = 'INSERT' then
      v_check_components := true;
    elsif old.status is distinct from 'active' then
      v_check_components := true;
    end if;
  end if;

  if v_check_components then
    select count(*),
           count(*) filter (where m.id is null or not m.active),
           count(*) filter (
             where rc.mode = 'fill_to_volume' and m.base_unit <> 'ml'
           ),
           coalesce(sum(rc.quantity) filter (
             where rc.mode = 'fixed' and m.base_unit = 'ml'
           ), 0)
      into v_component_count, v_inactive_component_count,
           v_invalid_fill_count, v_fixed_ml
      from public.recipe_components as rc
      left join public.materials as m on m.id = rc.material_id
     where rc.recipe_id = new.id;

    if v_component_count = 0 then
      raise exception 'A recipe needs at least one active material component'
        using errcode = '23514';
    end if;
    if v_inactive_component_count > 0 then
      raise exception 'All recipe component materials must be active'
        using errcode = '23514';
    end if;
    if v_invalid_fill_count > 0 then
      raise exception 'fill_to_volume components must use ml'
        using errcode = '23514';
    end if;
    if v_fixed_ml > new.size_ml or (
      exists (
        select 1
          from public.recipe_components rc
         where rc.recipe_id = new.id
           and rc.mode = 'fill_to_volume'
      )
      and v_fixed_ml >= new.size_ml
    ) then
      raise exception 'Fixed ml components leave no valid final volume'
        using errcode = '23514';
    end if;

    select p.active
      into v_perfume_active
      from public.perfumes as p
     where p.id = new.perfume_id;
    if not coalesce(v_perfume_active, false) then
      raise exception 'An active recipe requires an active perfume'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.prevent_active_recipe_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'active' then
    raise exception 'Archive an active recipe before deleting it'
      using errcode = '55000';
  end if;
  return old;
end;
$$;

create or replace function private.validate_material_unit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.base_unit is distinct from old.base_unit and (
    old.on_hand_qty <> 0
    or exists (
      select 1 from public.recipe_components rc
      where rc.material_id = old.id
    )
    or exists (
      select 1 from public.inventory_movements im
      where im.material_id = old.id
    )
    or exists (
      select 1 from public.purchase_items pi
      where pi.material_id = old.id
    )
  ) then
    raise exception 'A material unit cannot change after it is used or stocked'
      using errcode = '55000';
  end if;
  if old.active and not new.active and exists (
    select 1
      from public.recipe_components as rc
      join public.recipes as r on r.id = rc.recipe_id
     where rc.material_id = old.id
       and r.status = 'active'
  ) then
    raise exception 'A material used by an active recipe cannot be deactivated'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function private.validate_purchase_item_draft()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_purchase_id uuid;
  v_status public.purchase_status;
begin
  if tg_op = 'DELETE' then
    v_purchase_id := old.purchase_id;
  else
    v_purchase_id := new.purchase_id;
  end if;

  select p.status
    into v_status
    from public.purchases as p
   where p.id = v_purchase_id
   for update;
  if not found then
    if tg_op = 'DELETE' then
      return old;
    end if;
    raise exception 'Purchase does not exist' using errcode = '23503';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only draft purchase lines can be edited'
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function private.validate_purchase_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null
     or private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'Administrator access is required for purchase changes'
      using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.status := 'draft';
    new.received_at := null;
    new.total_cop := 0;
  elsif old.status <> 'draft' then
    raise exception 'Only draft purchases can be changed'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();
create trigger set_updated_at
before update on public.perfumes
for each row execute function private.set_updated_at();
create trigger set_updated_at
before update on public.retail_products
for each row execute function private.set_updated_at();
create trigger set_updated_at
before update on public.materials
for each row execute function private.set_updated_at();
create trigger set_updated_at
before update on public.recipes
for each row execute function private.set_updated_at();
create trigger set_updated_at
before update on public.recipe_components
for each row execute function private.set_updated_at();
create trigger set_updated_at
before update on public.customers
for each row execute function private.set_updated_at();
create trigger set_updated_at
before update on public.suppliers
for each row execute function private.set_updated_at();
create trigger set_updated_at
before update on public.sales
for each row execute function private.set_updated_at();
create trigger set_updated_at
before update on public.purchases
for each row execute function private.set_updated_at();
create trigger set_updated_at
before update on public.expenses
for each row execute function private.set_updated_at();
create trigger set_updated_at
before update on public.cash_sessions
for each row execute function private.set_updated_at();

create trigger validate_recipe_component
before insert or update or delete on public.recipe_components
for each row execute function private.validate_recipe_component();
create trigger validate_recipe_activation
before insert or update on public.recipes
for each row execute function private.validate_recipe_activation();
create trigger prevent_active_recipe_delete
before delete on public.recipes
for each row execute function private.prevent_active_recipe_delete();
create trigger validate_material_unit_change
before update of base_unit on public.materials
for each row execute function private.validate_material_unit_change();
create trigger validate_purchase_write
before insert or update on public.purchases
for each row execute function private.validate_purchase_write();
create trigger validate_purchase_item_draft
before insert or update or delete on public.purchase_items
for each row execute function private.validate_purchase_item_draft();

create trigger audit_perfumes
after insert or update or delete on public.perfumes
for each row execute function private.audit_row_change();
create trigger audit_profiles
after insert or update or delete on public.profiles
for each row execute function private.audit_row_change();
create trigger audit_retail_products
after insert or update or delete on public.retail_products
for each row execute function private.audit_row_change();
create trigger audit_materials
after insert or update or delete on public.materials
for each row execute function private.audit_row_change();
create trigger audit_recipes
after insert or update or delete on public.recipes
for each row execute function private.audit_row_change();
create trigger audit_recipe_components
after insert or update or delete on public.recipe_components
for each row execute function private.audit_row_change();
create trigger audit_customers
after insert or update or delete on public.customers
for each row execute function private.audit_row_change();
create trigger audit_suppliers
after insert or update or delete on public.suppliers
for each row execute function private.audit_row_change();
create trigger audit_sales
after insert or update or delete on public.sales
for each row execute function private.audit_row_change();
create trigger audit_sale_items
after insert or update or delete on public.sale_items
for each row execute function private.audit_row_change();
create trigger audit_sale_material_usage
after insert or update or delete on public.sale_material_usage
for each row execute function private.audit_row_change();
create trigger audit_purchases
after insert or update or delete on public.purchases
for each row execute function private.audit_row_change();
create trigger audit_purchase_items
after insert or update or delete on public.purchase_items
for each row execute function private.audit_row_change();
create trigger audit_inventory_movements
after insert or update or delete on public.inventory_movements
for each row execute function private.audit_row_change();
create trigger audit_expenses
after insert or update or delete on public.expenses
for each row execute function private.audit_row_change();
create trigger audit_cash_sessions
after insert or update or delete on public.cash_sessions
for each row execute function private.audit_row_change();
create trigger audit_cash_movements
after insert or update or delete on public.cash_movements
for each row execute function private.audit_row_change();

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
    from public.recipes as r
   where r.id = p_recipe_id
   for update;
  if not found then
    raise exception 'Recipe version not found' using errcode = 'P0002';
  end if;

  select coalesce(max(r.version), 0) + 1
    into v_version
    from public.recipes as r
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
    from public.recipe_components as rc
   where rc.recipe_id = v_source.id;

  return v_new_id;
end;
$$;

create or replace function public.activate_recipe(p_recipe_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_recipe public.recipes%rowtype;
begin
  if v_actor is null
     or private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an authenticated administrator can activate recipes'
      using errcode = '42501';
  end if;

  select r.*
    into v_recipe
    from public.recipes as r
   where r.id = p_recipe_id
   for update;
  if not found then
    raise exception 'Recipe version not found' using errcode = 'P0002';
  end if;
  if v_recipe.status <> 'draft' then
    raise exception 'Only draft recipe versions can be activated'
      using errcode = '55000';
  end if;

  perform 1
    from public.recipe_components as rc
    join public.materials as m on m.id = rc.material_id
   where rc.recipe_id = p_recipe_id
     and m.active
   order by rc.id
   for share of rc, m;

  if not exists (
    select 1
    from public.recipe_components as rc
    join public.materials as m on m.id = rc.material_id
    where rc.recipe_id = p_recipe_id
  ) then
    raise exception 'A recipe needs at least one active material component'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.recipe_components as rc
    join public.materials as m on m.id = rc.material_id
    where rc.recipe_id = p_recipe_id and not m.active
  ) then
    raise exception 'All recipe component materials must be active'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.recipe_components as rc
    join public.materials as m on m.id = rc.material_id
    where rc.recipe_id = p_recipe_id
      and rc.mode = 'fill_to_volume'
      and m.base_unit <> 'ml'
  ) then
    raise exception 'fill_to_volume components must use ml'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.recipe_components as rc
    join public.materials as m on m.id = rc.material_id
    where rc.recipe_id = p_recipe_id
      and rc.mode = 'fixed'
      and m.base_unit = 'ml'
    group by rc.recipe_id
    having sum(rc.quantity) > v_recipe.size_ml
      or (
        sum(rc.quantity) >= v_recipe.size_ml
        and exists (
          select 1
          from public.recipe_components fill_component
          where fill_component.recipe_id = p_recipe_id
            and fill_component.mode = 'fill_to_volume'
        )
      )
  ) then
    raise exception 'Fixed ml components leave no valid final volume'
      using errcode = '23514';
  end if;

  update public.recipes
     set status = 'archived'
   where perfume_id = v_recipe.perfume_id
     and size_ml = v_recipe.size_ml
     and status = 'active';

  update public.recipes
     set status = 'active'
   where id = p_recipe_id;
end;
$$;

create or replace function public.receive_purchase(p_purchase_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_purchase public.purchases%rowtype;
  v_item record;
  v_stock numeric(14, 4);
  v_average bigint;
  v_new_average bigint;
  v_new_stock numeric(14, 4);
  v_total bigint;
begin
  if v_actor is null
     or private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an authenticated administrator can receive purchases'
      using errcode = '42501';
  end if;

  select p.*
    into v_purchase
    from public.purchases as p
   where p.id = p_purchase_id
   for update;
  if not found then
    raise exception 'Purchase not found' using errcode = 'P0002';
  end if;
  if v_purchase.status <> 'draft' then
    raise exception 'Only draft purchases can be received'
      using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.purchase_items as pi
    where pi.purchase_id = p_purchase_id
  ) then
    raise exception 'A purchase needs at least one line item'
      using errcode = '23514';
  end if;
  if exists (
    select 1
      from public.purchase_items as pi
      left join public.materials as m on m.id = pi.material_id
      left join public.retail_products as rp on rp.id = pi.retail_product_id
     where pi.purchase_id = p_purchase_id
       and (
         (pi.material_id is not null and (m.id is null or not m.active))
         or (pi.retail_product_id is not null and (rp.id is null or not rp.active))
       )
  ) then
    raise exception 'A purchase line references an inactive or missing item'
      using errcode = '23514';
  end if;

  perform rp.id
    from public.retail_products as rp
    join public.purchase_items as pi on pi.retail_product_id = rp.id
   where pi.purchase_id = p_purchase_id
   order by rp.id
   for update of rp;

  perform m.id
    from public.materials as m
    join public.purchase_items as pi on pi.material_id = m.id
   where pi.purchase_id = p_purchase_id
   order by m.id
   for update of m;

  for v_item in
    select pi.*
      from public.purchase_items as pi
     where pi.purchase_id = p_purchase_id
     order by pi.material_id nulls last, pi.retail_product_id nulls last
  loop
    if v_item.material_id is not null then
      select m.on_hand_qty, m.avg_unit_cost_cop
        into v_stock, v_average
        from public.materials as m
       where m.id = v_item.material_id;
    else
      select rp.stock_qty, rp.avg_unit_cost_cop
        into v_stock, v_average
        from public.retail_products as rp
       where rp.id = v_item.retail_product_id;
    end if;
    if not found then
      raise exception 'A purchase line references an unavailable item'
        using errcode = '23503';
    end if;

    v_new_stock := v_stock + v_item.quantity;
    v_new_average := case
      when v_stock = 0 then v_item.unit_cost_cop
      else round(
        (v_stock * v_average + v_item.quantity * v_item.unit_cost_cop)
        / v_new_stock
      )::bigint
    end;

    if v_item.material_id is not null then
      update public.materials
         set on_hand_qty = v_new_stock,
             avg_unit_cost_cop = v_new_average
       where id = v_item.material_id;
    else
      update public.retail_products
         set stock_qty = v_new_stock,
             avg_unit_cost_cop = v_new_average
       where id = v_item.retail_product_id;
    end if;

    insert into public.inventory_movements (
      material_id, retail_product_id, movement_type, purchase_item_id,
      quantity_delta, unit_cost_cop, total_cost_cop, created_by
    )
    values (
      v_item.material_id, v_item.retail_product_id, 'purchase',
      v_item.id, v_item.quantity, v_item.unit_cost_cop,
      v_item.line_total_cop, v_actor
    );
  end loop;

  select sum(pi.line_total_cop)::bigint
    into v_total
    from public.purchase_items as pi
   where pi.purchase_id = p_purchase_id;

  update public.purchases
     set status = 'received',
         received_at = now(),
         total_cop = v_total
   where id = p_purchase_id;

  return v_total;
end;
$$;

create or replace function public.cancel_purchase(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_purchase public.purchases%rowtype;
begin
  if v_actor is null
     or private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an authenticated administrator can cancel purchases'
      using errcode = '42501';
  end if;

  select p.*
    into v_purchase
    from public.purchases as p
   where p.id = p_purchase_id
   for update;
  if not found then
    raise exception 'Purchase not found' using errcode = 'P0002';
  end if;
  if v_purchase.status <> 'draft' then
    raise exception 'Only draft purchases can be cancelled'
      using errcode = '55000';
  end if;

  update public.purchases
     set status = 'cancelled'
   where id = p_purchase_id;
end;
$$;

create or replace function public.adjust_inventory(
  p_material_id uuid,
  p_retail_product_id uuid,
  p_quantity_delta numeric,
  p_reason text,
  p_inbound_unit_cost_cop bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_movement_id uuid;
  v_stock numeric(14, 4);
  v_average bigint;
  v_new_stock numeric(14, 4);
  v_new_average bigint;
  v_delta numeric(14, 4);
  v_type public.inventory_movement_type;
  v_cost bigint;
begin
  if v_actor is null
     or private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an authenticated administrator can adjust inventory'
      using errcode = '42501';
  end if;
  if (p_material_id is null) = (p_retail_product_id is null) then
    raise exception 'Specify exactly one material or retail product'
      using errcode = '22023';
  end if;
  if p_quantity_delta is null
     or p_quantity_delta = 0
     or p_quantity_delta::text in ('NaN', 'Infinity', '-Infinity')
     or abs(p_quantity_delta) > 999999999.9999 then
    raise exception 'Adjustment quantity must be finite, non-zero, and in range'
      using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 240 then
    raise exception 'A reason of 1 to 240 characters is required'
      using errcode = '22023';
  end if;
  if p_quantity_delta > 0 and (
    p_inbound_unit_cost_cop is null or p_inbound_unit_cost_cop < 0
  ) then
    raise exception 'Inbound adjustments require an explicit non-negative COP unit cost'
      using errcode = '22023';
  end if;
  if p_quantity_delta < 0 and p_inbound_unit_cost_cop is not null then
    raise exception 'Outbound adjustments use the current weighted average cost'
      using errcode = '22023';
  end if;
  if p_retail_product_id is not null
     and p_quantity_delta <> trunc(p_quantity_delta) then
    raise exception 'Retail product inventory is counted in whole units'
      using errcode = '22023';
  end if;

  v_delta := p_quantity_delta;
  if v_delta > 0 then
    v_type := 'adjustment_in';
    v_cost := p_inbound_unit_cost_cop;
  else
    v_type := 'adjustment_out';
  end if;

  if p_material_id is not null then
    select m.on_hand_qty, m.avg_unit_cost_cop
      into v_stock, v_average
      from public.materials as m
     where m.id = p_material_id
       and m.active
     for update;
  else
    select rp.stock_qty, rp.avg_unit_cost_cop
      into v_stock, v_average
      from public.retail_products as rp
     where rp.id = p_retail_product_id
       and rp.active
     for update;
  end if;
  if not found then
    raise exception 'Active inventory item not found' using errcode = 'P0002';
  end if;

  if v_delta < 0 then
    if v_stock < abs(v_delta) then
      raise exception 'Inventory adjustment cannot make stock negative'
        using errcode = '23514';
    end if;
    v_new_stock := v_stock + v_delta;
    v_cost := v_average;
  else
    v_new_stock := v_stock + v_delta;
    v_new_average := case
      when v_stock = 0 then v_cost
      else round((v_stock * v_average + v_delta * v_cost) / v_new_stock)::bigint
    end;
  end if;

  if v_delta > 0 then
    if p_material_id is not null then
      update public.materials
         set on_hand_qty = v_new_stock,
             avg_unit_cost_cop = v_new_average
       where id = p_material_id;
    else
      update public.retail_products
         set stock_qty = v_new_stock,
             avg_unit_cost_cop = v_new_average
       where id = p_retail_product_id;
    end if;
  else
    if p_material_id is not null then
      update public.materials
         set on_hand_qty = v_new_stock
       where id = p_material_id;
    else
      update public.retail_products
         set stock_qty = v_new_stock
       where id = p_retail_product_id;
    end if;
  end if;

  insert into public.inventory_movements (
    material_id, retail_product_id, movement_type, quantity_delta,
    unit_cost_cop, total_cost_cop, reason, created_by
  )
  values (
    p_material_id, p_retail_product_id, v_type, v_delta,
    v_cost, round(abs(v_delta) * v_cost)::bigint, btrim(p_reason), v_actor
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

create or replace function public.register_sale(
  p_items jsonb,
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
  v_role public.app_role;
  v_sale_id uuid;
  v_item_id uuid;
  v_line record;
  v_recipe public.recipes%rowtype;
  v_product public.retail_products%rowtype;
  v_component record;
  v_session public.cash_sessions%rowtype;
  v_unit_price bigint;
  v_unit_cost bigint;
  v_line_total bigint;
  v_line_cost bigint;
  v_total bigint := 0;
  v_total_cost bigint := 0;
  v_bottle_cost bigint;
  v_use_qty numeric(14, 4);
  v_usage_cost bigint;
  v_size integer;
  v_recipe_snapshot jsonb;
  v_item_name text;
  v_stock numeric(14, 4);
  v_affected integer;
begin
  v_role := private.current_role();
  if v_actor is null or v_role is null or v_role not in (
      'admin'::public.app_role, 'employee'::public.app_role
    ) then
    raise exception 'An authenticated employee or administrator is required'
      using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Sale items must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 100 then
    raise exception 'Sale must contain between 1 and 100 lines'
      using errcode = '22023';
  end if;
  if p_payment_method is null then
    raise exception 'Payment method is required' using errcode = '22023';
  end if;
  if p_notes is not null and length(p_notes) > 1000 then
    raise exception 'Sale notes are too long' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as e(value)
    where jsonb_typeof(e.value) is distinct from 'object'
       or (e.value - array['kind', 'id', 'quantity']) <> '{}'::jsonb
       or jsonb_typeof(e.value -> 'kind') is distinct from 'string'
       or coalesce(e.value ->> 'kind', '') not in ('retail_product', 'recipe')
       or jsonb_typeof(e.value -> 'id') is distinct from 'string'
       or jsonb_typeof(e.value -> 'quantity') is distinct from 'number'
       or coalesce(e.value ->> 'quantity', '') !~ '^[0-9]+([.][0-9]{1,3})?$'
  ) then
    raise exception 'Sale line has an invalid shape, item type, id, or quantity'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_items) as e(value)
     where (e.value ->> 'quantity')::numeric <= 0
  ) then
    raise exception 'Sale quantities must be positive'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as e(value)
    group by e.value ->> 'kind', (e.value ->> 'id')::uuid
    having count(*) > 1
  ) then
    raise exception 'Each item may appear only once in a sale'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as e(value)
    where (e.value ->> 'quantity')::numeric > 999999999.999
  ) then
    raise exception 'Sale quantity exceeds the supported range'
      using errcode = '22003';
  end if;

  if p_payment_method = 'cash' then
    if p_cash_session_id is null then
      raise exception 'Cash sales require an open cash session'
        using errcode = '22023';
    end if;
  elsif p_cash_session_id is not null then
    raise exception 'A cash session may only be attached to a cash sale'
      using errcode = '22023';
  end if;

  if p_customer_id is not null and not exists (
    select 1 from public.customers c where c.id = p_customer_id
  ) then
    raise exception 'Customer not found' using errcode = '23503';
  end if;

  -- Keep the lock order stable: retail stock, recipe versions, then materials.
  perform rp.id
    from public.retail_products as rp
    join jsonb_array_elements(p_items) as e(value)
      on e.value ->> 'kind' = 'retail_product'
     and rp.id = (e.value ->> 'id')::uuid
   order by rp.id
   for update of rp;

  perform r.id
    from public.recipes as r
    join jsonb_array_elements(p_items) as e(value)
      on e.value ->> 'kind' = 'recipe'
     and r.id = (e.value ->> 'id')::uuid
   order by r.id
   for share of r;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as e(value)
    where e.value ->> 'kind' = 'retail_product'
      and not exists (
        select 1 from public.retail_products rp
        where rp.id = (e.value ->> 'id')::uuid and rp.active
      )
  ) then
    raise exception 'A retail product is missing or inactive'
      using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) as e(value)
    where e.value ->> 'kind' = 'recipe'
      and not exists (
        select 1 from public.recipes r
        where r.id = (e.value ->> 'id')::uuid and r.status = 'active'
      )
  ) then
    raise exception 'An active recipe version was not found'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as e(value)
    join public.retail_products rp on rp.id = (e.value ->> 'id')::uuid
    where e.value ->> 'kind' = 'retail_product'
      and (e.value ->> 'quantity')::numeric <> trunc((e.value ->> 'quantity')::numeric)
  ) then
    raise exception 'Retail products are sold only in whole units'
      using errcode = '22023';
  end if;

  perform m.id
    from public.materials as m
   where exists (
     select 1
       from public.recipe_components as rc
       join jsonb_array_elements(p_items) as e(value)
         on e.value ->> 'kind' = 'recipe'
        and rc.recipe_id = (e.value ->> 'id')::uuid
      where rc.material_id = m.id
   )
   order by m.id
   for update of m;

  if p_payment_method = 'cash' then
    select cs.*
      into v_session
      from public.cash_sessions as cs
     where cs.id = p_cash_session_id
       and cs.status = 'open'
       and cs.opened_by = v_actor
     for update;
    if not found then
      raise exception 'Open cash session not found for the current user'
        using errcode = '42501';
    end if;
  end if;

  insert into public.sales (
    created_by, customer_id, cash_session_id, payment_method,
    subtotal_cop, total_cop, total_cost_cop, notes
  )
  values (
    v_actor, p_customer_id, p_cash_session_id, p_payment_method,
    0, 0, 0, nullif(btrim(p_notes), '')
  )
  returning id into v_sale_id;

  for v_line in
    select e.value ->> 'kind' as kind,
           (e.value ->> 'id')::uuid as item_id,
           (e.value ->> 'quantity')::numeric(14, 3) as quantity,
           e.ordinality
      from jsonb_array_elements(p_items) with ordinality as e(value, ordinality)
     order by e.ordinality
  loop
    if v_line.kind = 'retail_product' then
      select rp.*
        into v_product
        from public.retail_products as rp
       where rp.id = v_line.item_id;
      if v_product.stock_qty < v_line.quantity then
        raise exception 'Insufficient stock for retail product %', v_product.sku
          using errcode = '23514';
      end if;

      v_unit_price := v_product.price_cop;
      v_unit_cost := v_product.avg_unit_cost_cop;
      v_line_total := round(v_line.quantity * v_unit_price)::bigint;
      v_line_cost := round(v_line.quantity * v_unit_cost)::bigint;

      insert into public.sale_items (
        sale_id, item_type, retail_product_id, item_name_snapshot,
        product_type_snapshot, quantity, unit_price_cop, line_total_cop,
        unit_cost_cop, line_cost_cop
      )
      values (
        v_sale_id, 'retail_product', v_product.id, v_product.name,
        v_product.product_type, v_line.quantity, v_unit_price, v_line_total,
        v_unit_cost, v_line_cost
      )
      returning id into v_item_id;

      update public.retail_products
         set stock_qty = stock_qty - v_line.quantity
       where id = v_product.id
         and stock_qty >= v_line.quantity;
      get diagnostics v_affected = row_count;
      if v_affected <> 1 then
        raise exception 'Retail stock changed during sale'
          using errcode = '40001';
      end if;

      insert into public.inventory_movements (
        retail_product_id, movement_type, sale_item_id, quantity_delta,
        unit_cost_cop, total_cost_cop, created_by
      )
      values (
        v_product.id, 'sale', v_item_id, -v_line.quantity,
        v_unit_cost, v_line_cost, v_actor
      );
    else
      select r.*
        into v_recipe
        from public.recipes as r
       where r.id = v_line.item_id
         and r.status = 'active';
      if not found then
        raise exception 'Active recipe version was not found'
          using errcode = 'P0002';
      end if;

      select p.name
        into v_item_name
        from public.perfumes as p
       where p.id = v_recipe.perfume_id
         and p.active;
      if not found then
        raise exception 'Recipe perfume is missing or inactive'
          using errcode = '23514';
      end if;

      v_size := v_recipe.size_ml;
      select coalesce(sum(rc.quantity), 0)
        into v_stock
        from public.recipe_components as rc
        join public.materials as m on m.id = rc.material_id
       where rc.recipe_id = v_recipe.id
         and rc.mode = 'fixed'
         and m.base_unit = 'ml';
      if exists (
        select 1 from public.recipe_components rc
        where rc.recipe_id = v_recipe.id and rc.mode = 'fill_to_volume'
      ) and v_size - v_stock <= 0 then
        raise exception 'fill_to_volume has no positive remaining volume'
          using errcode = '23514';
      end if;

      select coalesce(
        sum(round(
          (
            case
              when rc.mode = 'fill_to_volume' then v_size - v_stock
              else rc.quantity
            end
          ) * m.avg_unit_cost_cop
        )::bigint),
        0
      )
        into v_bottle_cost
        from public.recipe_components as rc
        join public.materials as m on m.id = rc.material_id
       where rc.recipe_id = v_recipe.id
         and m.active;
      if not exists (
        select 1
        from public.recipe_components rc
        join public.materials m on m.id = rc.material_id
        where rc.recipe_id = v_recipe.id and m.active
      ) then
        raise exception 'Recipe has no active material components'
          using errcode = '23514';
      end if;
      select coalesce(
        sum(round(
          (
            case
              when rc.mode = 'fill_to_volume' then v_size - v_stock
              else rc.quantity
            end
          ) * v_line.quantity * m.avg_unit_cost_cop
        )::bigint),
        0
      )
        into v_line_cost
        from public.recipe_components as rc
        join public.materials as m on m.id = rc.material_id
       where rc.recipe_id = v_recipe.id
         and m.active;

      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'material_id', m.id,
            'name', m.name,
            'unit', m.base_unit,
            'mode', rc.mode,
            'quantity_per_bottle',
              case when rc.mode = 'fill_to_volume' then v_size - v_stock
                   else rc.quantity end,
            'unit_cost_cop', m.avg_unit_cost_cop,
            'extended_cost_cop', round(
              (
                case when rc.mode = 'fill_to_volume' then v_size - v_stock
                     else rc.quantity end
              ) * v_line.quantity * m.avg_unit_cost_cop
            )::bigint
          ) order by rc.id
        ),
        '[]'::jsonb
      )
        into v_recipe_snapshot
        from public.recipe_components as rc
        join public.materials as m on m.id = rc.material_id
       where rc.recipe_id = v_recipe.id
         and m.active;
      v_recipe_snapshot := jsonb_build_object(
        'recipe_id', v_recipe.id,
        'perfume_id', v_recipe.perfume_id,
        'perfume_name', v_item_name,
        'size_ml', v_recipe.size_ml,
        'version', v_recipe.version,
        'price_cop', v_recipe.price_cop,
        'unit_cost_cop', v_bottle_cost,
        'components', v_recipe_snapshot
      );

      v_unit_price := v_recipe.price_cop;
      v_line_total := round(v_line.quantity * v_unit_price)::bigint;
      v_unit_cost := v_bottle_cost;

      insert into public.sale_items (
        sale_id, item_type, recipe_id, item_name_snapshot, size_ml_snapshot,
        recipe_version_snapshot, quantity, unit_price_cop, line_total_cop,
        unit_cost_cop, line_cost_cop, recipe_snapshot
      )
      values (
        v_sale_id, 'recipe', v_recipe.id, v_item_name, v_recipe.size_ml,
        v_recipe.version, v_line.quantity, v_unit_price, v_line_total,
        v_unit_cost, v_line_cost, v_recipe_snapshot
      )
      returning id into v_item_id;

      for v_component in
        select rc.id as component_id,
               rc.material_id,
               m.name as material_name,
               m.base_unit,
               m.avg_unit_cost_cop,
               m.on_hand_qty,
               case
                 when rc.mode = 'fill_to_volume' then v_size - v_stock
                 else rc.quantity
               end as quantity_per_bottle
          from public.recipe_components as rc
          join public.materials as m on m.id = rc.material_id
         where rc.recipe_id = v_recipe.id
           and m.active
         order by m.id, rc.id
      loop
        v_use_qty := v_component.quantity_per_bottle * v_line.quantity;
        v_usage_cost := round(v_use_qty * v_component.avg_unit_cost_cop)::bigint;

        update public.materials
           set on_hand_qty = on_hand_qty - v_use_qty
         where id = v_component.material_id
           and on_hand_qty >= v_use_qty;
        get diagnostics v_affected = row_count;
        if v_affected <> 1 then
          raise exception 'Insufficient material stock for %', v_component.material_name
            using errcode = '23514';
        end if;

        insert into public.sale_material_usage (
          sale_item_id, material_id, material_name_snapshot, unit_snapshot,
          quantity_used, unit_cost_cop, total_cost_cop
        )
        values (
          v_item_id, v_component.material_id, v_component.material_name,
          v_component.base_unit, v_use_qty, v_component.avg_unit_cost_cop,
          v_usage_cost
        );

        insert into public.inventory_movements (
          material_id, movement_type, sale_item_id, quantity_delta,
          unit_cost_cop, total_cost_cop, created_by
        )
        values (
          v_component.material_id, 'sale', v_item_id, -v_use_qty,
          v_component.avg_unit_cost_cop, v_usage_cost, v_actor
        );
      end loop;
    end if;

    v_total := v_total + v_line_total;
    v_total_cost := v_total_cost + v_line_cost;
  end loop;

  update public.sales
     set subtotal_cop = v_total,
         total_cop = v_total,
         total_cost_cop = v_total_cost
   where id = v_sale_id;

  if p_payment_method = 'cash' then
    insert into public.cash_movements (
      cash_session_id, movement_type, sale_id, amount_cop, created_by,
      description
    )
    values (
      p_cash_session_id, 'sale_in', v_sale_id, v_total, v_actor,
      'Venta ' || v_sale_id::text
    );

    update public.cash_sessions
       set expected_cop = expected_cop + v_total
     where id = p_cash_session_id
       and status = 'open'
       and opened_by = v_actor;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception 'Cash session changed during sale'
        using errcode = '40001';
    end if;
  end if;

  return v_sale_id;
end;
$$;

create or replace function public.open_cash_session(p_opening_cop bigint)
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
  if p_opening_cop is null or p_opening_cop < 0 then
    raise exception 'Opening cash must be a non-negative COP integer'
      using errcode = '22023';
  end if;

  insert into public.cash_sessions (opened_by, opening_cop, expected_cop)
  values (v_actor, p_opening_cop, p_opening_cop)
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

create or replace function public.close_cash_session(
  p_cash_session_id uuid,
  p_counted_cop bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.cash_sessions%rowtype;
  v_expected bigint;
  v_difference bigint;
begin
  if v_actor is null or not private.is_employee_or_admin() then
    raise exception 'An authenticated employee or administrator is required'
      using errcode = '42501';
  end if;
  if p_counted_cop is null or p_counted_cop < 0 then
    raise exception 'Counted cash must be a non-negative COP integer'
      using errcode = '22023';
  end if;

  select cs.*
    into v_session
    from public.cash_sessions as cs
   where cs.id = p_cash_session_id
     and cs.status = 'open'
     and (cs.opened_by = v_actor or private.is_admin())
   for update;
  if not found then
    raise exception 'Open cash session not found or access denied'
      using errcode = '42501';
  end if;

  select coalesce(sum(cm.signed_amount_cop), 0)::bigint
    into v_expected
    from public.cash_movements as cm
   where cm.cash_session_id = p_cash_session_id;
  v_difference := p_counted_cop - v_expected;

  update public.cash_sessions
     set status = 'closed',
         closed_at = now(),
         expected_cop = v_expected,
         counted_cop = p_counted_cop,
         difference_cop = v_difference
   where id = p_cash_session_id;

  return v_difference;
end;
$$;

create or replace function public.record_expense(
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
  if p_description is null or length(btrim(p_description)) not between 1 and 240
     or p_amount_cop is null or p_amount_cop <= 0
     or p_expense_date is null or p_payment_method is null then
    raise exception 'Expense description, positive COP amount, date, and payment method are required'
      using errcode = '22023';
  end if;
  if p_notes is not null and length(p_notes) > 1000 then
    raise exception 'Expense notes are too long' using errcode = '22023';
  end if;
  if p_payment_method = 'cash' and p_cash_session_id is null then
    raise exception 'Cash expenses require an open cash session'
      using errcode = '22023';
  end if;
  if p_payment_method <> 'cash' and p_cash_session_id is not null then
    raise exception 'A cash session may only be attached to a cash expense'
      using errcode = '22023';
  end if;

  if p_cash_session_id is not null then
    select cs.*
      into v_session
      from public.cash_sessions as cs
     where cs.id = p_cash_session_id
       and cs.status = 'open'
     for update;
    if not found then
      raise exception 'Open cash session not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.expenses (
    created_by, description, amount_cop, expense_date, payment_method,
    cash_session_id, notes
  )
  values (
    v_actor, btrim(p_description), p_amount_cop, p_expense_date,
    p_payment_method, p_cash_session_id, nullif(btrim(p_notes), '')
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
     where id = p_cash_session_id
       and status = 'open';
  end if;

  return v_expense_id;
end;
$$;

create or replace function public.admin_inventory_costs()
returns table (
  item_kind text,
  item_id uuid,
  item_name text,
  quantity_on_hand numeric,
  unit text,
  avg_unit_cost_cop bigint,
  inventory_value_cop bigint
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

  return query
    select 'material'::text, m.id, m.name, m.on_hand_qty,
           m.base_unit::text, m.avg_unit_cost_cop,
           round(m.on_hand_qty * m.avg_unit_cost_cop)::bigint
      from public.materials as m
    union all
    select 'retail_product'::text, rp.id, rp.name, rp.stock_qty,
           'unit'::text, rp.avg_unit_cost_cop,
           round(rp.stock_qty * rp.avg_unit_cost_cop)::bigint
      from public.retail_products as rp;
end;
$$;

create or replace function public.admin_sale_costs(p_sale_id uuid)
returns table (
  sale_id uuid,
  total_cop bigint,
  total_cost_cop bigint,
  profit_cop bigint,
  items jsonb
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

  return query
    select s.id,
           s.total_cop,
           s.total_cost_cop,
           s.total_cop - s.total_cost_cop,
           coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'sale_item_id', si.id,
                 'name', si.item_name_snapshot,
                 'quantity', si.quantity,
                 'unit_price_cop', si.unit_price_cop,
                 'unit_cost_cop', si.unit_cost_cop,
                 'line_total_cop', si.line_total_cop,
                 'line_cost_cop', si.line_cost_cop,
                 'recipe_snapshot', si.recipe_snapshot
               ) order by si.created_at, si.id
             ) filter (where si.id is not null),
             '[]'::jsonb
           )
      from public.sales as s
      left join public.sale_items as si on si.sale_id = s.id
     where s.id = p_sale_id
     group by s.id;

  if not found then
    raise exception 'Sale not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.create_recipe_version(uuid)
  from public, anon, authenticated;
revoke all on function public.activate_recipe(uuid)
  from public, anon, authenticated;
revoke all on function public.receive_purchase(uuid)
  from public, anon, authenticated;
revoke all on function public.cancel_purchase(uuid)
  from public, anon, authenticated;
revoke all on function public.adjust_inventory(
  uuid, uuid, numeric, text, bigint
) from public, anon, authenticated;
revoke all on function public.register_sale(
  jsonb, public.payment_method, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.open_cash_session(bigint)
  from public, anon, authenticated;
revoke all on function public.close_cash_session(uuid, bigint)
  from public, anon, authenticated;
revoke all on function public.record_expense(
  text, bigint, date, public.payment_method, uuid, text
) from public, anon, authenticated;
revoke all on function public.admin_inventory_costs()
  from public, anon, authenticated;
revoke all on function public.admin_sale_costs(uuid)
  from public, anon, authenticated;

grant execute on function public.create_recipe_version(uuid) to authenticated;
grant execute on function public.activate_recipe(uuid) to authenticated;
grant execute on function public.receive_purchase(uuid) to authenticated;
grant execute on function public.cancel_purchase(uuid) to authenticated;
grant execute on function public.adjust_inventory(
  uuid, uuid, numeric, text, bigint
) to authenticated;
grant execute on function public.register_sale(
  jsonb, public.payment_method, uuid, uuid, text
) to authenticated;
grant execute on function public.open_cash_session(bigint) to authenticated;
grant execute on function public.close_cash_session(uuid, bigint) to authenticated;
grant execute on function public.record_expense(
  text, bigint, date, public.payment_method, uuid, text
) to authenticated;
grant execute on function public.admin_inventory_costs() to authenticated;
grant execute on function public.admin_sale_costs(uuid) to authenticated;

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.audit_row_change() from public, anon, authenticated;
revoke all on function private.validate_recipe_component()
  from public, anon, authenticated;
revoke all on function private.validate_recipe_activation()
  from public, anon, authenticated;
