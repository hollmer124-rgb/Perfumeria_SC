-- Catalog metadata, auditable purchase drafts, and employee-safe stock history.

alter table public.retail_products
  add column brand text not null default '',
  add column supplier_id uuid references public.suppliers (id) on delete restrict,
  add column minimum_qty numeric(14, 3) not null default 0
    check (
      minimum_qty >= 0
      and minimum_qty = trunc(minimum_qty)
      and minimum_qty::text not in ('NaN', 'Infinity', '-Infinity')
    );

update public.retail_products rp
   set brand = coalesce(nullif(btrim(p.brand), ''), 'Marca pendiente')
  from public.perfumes p
 where p.id = rp.perfume_id
   and rp.brand = '';

update public.retail_products
   set brand = 'Marca pendiente'
 where brand = '';

alter table public.retail_products
  add constraint retail_products_brand_check
    check (length(btrim(brand)) between 1 and 120);
create index retail_products_low_stock_idx
  on public.retail_products (stock_qty, minimum_qty)
  where active;
create index retail_products_supplier_idx
  on public.retail_products (supplier_id)
  where supplier_id is not null;

alter table public.materials
  add column category text not null default 'other'
    check (category in ('essence', 'alcohol', 'pheromone', 'bottle', 'other')),
  add column perfume_id uuid references public.perfumes (id) on delete restrict,
  add column supplier_id uuid references public.suppliers (id) on delete restrict,
  add column size_ml integer;

alter table public.materials
  add constraint materials_size_ml_check
    check (size_ml is null or size_ml in (30, 50, 60, 100)),
  add constraint materials_category_reference_check
    check (
      (category = 'essence' and perfume_id is not null and size_ml is null)
      or (
        category = 'bottle'
        and perfume_id is null
        and size_ml is not null
        and base_unit = 'unit'
      )
      or (
        category not in ('essence', 'bottle')
        and perfume_id is null
        and size_ml is null
      )
    );
create index materials_category_name_idx
  on public.materials (category, name)
  where active;
create index materials_perfume_idx
  on public.materials (perfume_id)
  where perfume_id is not null;
create index materials_supplier_idx
  on public.materials (supplier_id)
  where supplier_id is not null;
create index materials_low_stock_idx
  on public.materials (on_hand_qty, minimum_qty)
  where active;

alter table public.purchase_items
  add column item_name_snapshot text,
  add column unit_snapshot text;

update public.purchase_items pi
   set item_name_snapshot = m.name,
       unit_snapshot = m.base_unit::text
  from public.materials m
 where m.id = pi.material_id;

update public.purchase_items pi
   set item_name_snapshot = rp.name,
       unit_snapshot = 'unit'
  from public.retail_products rp
 where rp.id = pi.retail_product_id;

alter table public.purchase_items
  alter column item_name_snapshot set not null,
  alter column unit_snapshot set not null,
  add constraint purchase_items_snapshot_check
    check (
      length(btrim(item_name_snapshot)) between 1 and 180
      and length(btrim(unit_snapshot)) between 1 and 20
    );

revoke select on public.retail_products from authenticated;
grant select (
  id, perfume_id, product_type, sku, name, brand, size_ml, price_cop,
  stock_qty, minimum_qty, supplier_id, active, created_at, updated_at
) on public.retail_products to authenticated;
grant insert (
  perfume_id, product_type, sku, name, brand, size_ml, price_cop,
  minimum_qty, supplier_id, active
) on public.retail_products to authenticated;
grant update (
  perfume_id, product_type, sku, name, brand, size_ml, price_cop,
  minimum_qty, supplier_id, active
) on public.retail_products to authenticated;

revoke select on public.materials from authenticated;
grant select (
  id, name, base_unit, on_hand_qty, minimum_qty, category, perfume_id,
  supplier_id, size_ml, active, created_at, updated_at
) on public.materials to authenticated;
grant insert (
  name, base_unit, minimum_qty, category, perfume_id, supplier_id, size_ml,
  active
) on public.materials to authenticated;
grant update (
  name, base_unit, minimum_qty, category, perfume_id, supplier_id, size_ml,
  active
) on public.materials to authenticated;

revoke select, insert, update, delete
  on public.inventory_movements from authenticated;
grant select (
  id, material_id, retail_product_id, movement_type, sale_item_id,
  purchase_item_id, quantity_delta, reason, created_by, created_at
) on public.inventory_movements to authenticated;

create policy inventory_movements_select_operational_stock
  on public.inventory_movements for select to authenticated
  using (
    (select private.is_admin())
    or (
      (select private.is_employee_or_admin())
      and (
        exists (
          select 1
            from public.materials m
           where m.id = inventory_movements.material_id
             and m.active
        )
        or exists (
          select 1
            from public.retail_products rp
           where rp.id = inventory_movements.retail_product_id
             and rp.active
        )
      )
    )
  );

revoke insert, update, delete on public.purchases from authenticated;
revoke insert, update, delete on public.purchase_items from authenticated;

create or replace function public.admin_save_retail_product(
  p_product_id uuid,
  p_name text,
  p_brand text,
  p_product_type public.retail_product_type,
  p_sku text,
  p_size_ml integer,
  p_price_cop bigint,
  p_minimum_qty numeric,
  p_supplier_id uuid,
  p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_perfume_id uuid;
  v_product_id uuid;
begin
  if v_actor is null
     or private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an authenticated administrator can manage catalog products'
      using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 180
     or p_brand is null or length(btrim(p_brand)) not between 1 and 120
     or p_sku is null or length(btrim(p_sku)) not between 1 and 80
     or p_product_type is null
     or p_size_ml is null
     or p_size_ml not in (30, 50, 60, 100)
     or p_price_cop is null or p_price_cop < 0
     or p_active is null
     or p_minimum_qty is null or p_minimum_qty < 0
     or p_minimum_qty <> trunc(p_minimum_qty)
     or p_minimum_qty::text in ('NaN', 'Infinity', '-Infinity')
     or (p_size_ml is not null and p_size_ml <= 0) then
    raise exception 'Catalog product fields are invalid'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.suppliers s
     where s.id = p_supplier_id and s.active
  ) then
    raise exception 'An active supplier is required'
      using errcode = '23503';
  end if;

  insert into public.perfumes (name, brand, active)
  values (btrim(p_name), btrim(p_brand), true)
  on conflict (brand, name) do update
    set active = true
  returning id into v_perfume_id;

  if p_product_id is null then
    insert into public.retail_products (
      perfume_id, product_type, sku, name, brand, size_ml, price_cop,
      minimum_qty, supplier_id, active
    )
    values (
      v_perfume_id, p_product_type, btrim(p_sku), btrim(p_name),
      btrim(p_brand), p_size_ml, p_price_cop, p_minimum_qty, p_supplier_id,
      p_active
    )
    returning id into v_product_id;
  else
    update public.retail_products
       set perfume_id = v_perfume_id,
           product_type = p_product_type,
           sku = btrim(p_sku),
           name = btrim(p_name),
           brand = btrim(p_brand),
           size_ml = p_size_ml,
           price_cop = p_price_cop,
           minimum_qty = p_minimum_qty,
           supplier_id = p_supplier_id,
           active = p_active
     where id = p_product_id;
    if not found then
      raise exception 'Catalog product not found'
        using errcode = 'P0002';
    end if;
    v_product_id := p_product_id;
  end if;

  return v_product_id;
end;
$$;

create or replace function public.create_purchase(
  p_supplier_id uuid,
  p_purchased_at date,
  p_items jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_purchase_id uuid;
  v_item record;
  v_material public.materials%rowtype;
  v_product public.retail_products%rowtype;
begin
  if v_actor is null
     or private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an authenticated administrator can create purchases'
      using errcode = '42501';
  end if;
  if p_supplier_id is null or not exists (
    select 1 from public.suppliers s
     where s.id = p_supplier_id and s.active
  ) then
    raise exception 'An active supplier is required'
      using errcode = '23503';
  end if;
  if p_purchased_at is null or p_purchased_at > current_date
     or p_notes is not null and length(p_notes) > 1000 then
    raise exception 'Purchase date or notes are invalid'
      using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Purchase must contain between 1 and 100 items'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_items) as e(value)
     where jsonb_typeof(e.value) is distinct from 'object'
        or (e.value - array['type', 'id', 'quantity', 'unit_cost_cop'])
          <> '{}'::jsonb
        or jsonb_typeof(e.value -> 'type') is distinct from 'string'
        or coalesce(e.value ->> 'type', '') not in ('material', 'retail_product')
        or jsonb_typeof(e.value -> 'id') is distinct from 'string'
        or coalesce(e.value ->> 'id', '')
          !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        or jsonb_typeof(e.value -> 'quantity') is distinct from 'number'
        or coalesce(e.value ->> 'quantity', '')
          !~ '^[0-9]+([.][0-9]{1,4})?$'
        or (e.value ->> 'quantity')::numeric <= 0
        or (e.value ->> 'quantity')::numeric > 999999999.9999
        or jsonb_typeof(e.value -> 'unit_cost_cop') is distinct from 'number'
        or coalesce(e.value ->> 'unit_cost_cop', '') !~ '^[0-9]+$'
        or (e.value ->> 'unit_cost_cop')::numeric > 9000000000000000
  ) then
    raise exception 'Purchase line has an invalid type, id, quantity, or unit cost'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_items) as e(value)
     group by e.value ->> 'type', (e.value ->> 'id')::uuid
    having count(*) > 1
  ) then
    raise exception 'Each inventory item may appear once per purchase'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_items) as e(value)
     where e.value ->> 'type' = 'retail_product'
       and (e.value ->> 'quantity')::numeric
         <> trunc((e.value ->> 'quantity')::numeric)
  ) then
    raise exception 'Finished products are purchased in whole units'
      using errcode = '22023';
  end if;

  insert into public.purchases (
    supplier_id, created_by, purchased_at, notes
  )
  values (
    p_supplier_id,
    v_actor,
    p_purchased_at::timestamp at time zone 'America/Bogota',
    nullif(btrim(p_notes), '')
  )
  returning id into v_purchase_id;

  for v_item in
    select e.value ->> 'type' as item_type,
           (e.value ->> 'id')::uuid as item_id,
           (e.value ->> 'quantity')::numeric(14, 4) as quantity,
           (e.value ->> 'unit_cost_cop')::bigint as unit_cost_cop
      from jsonb_array_elements(p_items) as e(value)
     order by e.value ->> 'type', (e.value ->> 'id')::uuid
  loop
    if v_item.item_type = 'material' then
      select m.* into v_material
        from public.materials m
       where m.id = v_item.item_id and m.active
       for key share;
      if not found then
        raise exception 'An active material in the purchase was not found'
          using errcode = '23503';
      end if;
      insert into public.purchase_items (
        purchase_id, material_id, quantity, unit_cost_cop,
        item_name_snapshot, unit_snapshot
      )
      values (
        v_purchase_id, v_material.id, v_item.quantity, v_item.unit_cost_cop,
        v_material.name, v_material.base_unit::text
      );
    else
      select rp.* into v_product
        from public.retail_products rp
       where rp.id = v_item.item_id and rp.active
       for key share;
      if not found then
        raise exception 'An active finished product in the purchase was not found'
          using errcode = '23503';
      end if;
      insert into public.purchase_items (
        purchase_id, retail_product_id, quantity, unit_cost_cop,
        item_name_snapshot, unit_snapshot
      )
      values (
        v_purchase_id, v_product.id, v_item.quantity, v_item.unit_cost_cop,
        v_product.name, 'unit'
      );
    end if;
  end loop;

  return v_purchase_id;
end;
$$;

revoke all on function public.admin_save_retail_product(
  uuid, text, text, public.retail_product_type, text, integer, bigint,
  numeric, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.admin_save_retail_product(
  uuid, text, text, public.retail_product_type, text, integer, bigint,
  numeric, uuid, boolean
) to authenticated;

revoke all on function public.create_purchase(uuid, date, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.create_purchase(uuid, date, jsonb, text)
  to authenticated;
