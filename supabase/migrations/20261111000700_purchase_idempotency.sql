create table private.purchase_idempotency (
  actor_id uuid not null references auth.users (id) on delete restrict,
  idempotency_key uuid not null,
  request_fingerprint bytea not null
    check (octet_length(request_fingerprint) = 32),
  purchase_id uuid not null unique
    references public.purchases (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (actor_id, idempotency_key)
);

revoke all on table private.purchase_idempotency
  from public, anon, authenticated;

drop function public.create_purchase(uuid, date, jsonb, text);

create function public.create_purchase(
  p_supplier_id uuid,
  p_purchased_at date,
  p_items jsonb,
  p_notes text,
  p_idempotency_key uuid
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
  v_canonical_request jsonb;
  v_fingerprint bytea;
  v_existing_fingerprint bytea;
begin
  if v_actor is null
     or private.current_role() is distinct from 'admin'::public.app_role then
    raise exception 'Only an authenticated administrator can create purchases'
      using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'An idempotency key is required'
      using errcode = '22023';
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

  select jsonb_build_object(
    'supplier_id', p_supplier_id,
    'purchased_at', p_purchased_at,
    'notes', nullif(btrim(p_notes), ''),
    'items', jsonb_agg(
      jsonb_build_object(
        'type', e.value ->> 'type',
        'id', (e.value ->> 'id')::uuid,
        'quantity', (e.value ->> 'quantity')::numeric(14, 4),
        'unit_cost_cop', (e.value ->> 'unit_cost_cop')::bigint
      )
      order by e.value ->> 'type', (e.value ->> 'id')::uuid
    )
  )
    into v_canonical_request
    from jsonb_array_elements(p_items) as e(value);
  v_fingerprint := extensions.digest(
    convert_to(v_canonical_request::text, 'UTF8'),
    'sha256'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select pi.request_fingerprint, pi.purchase_id
    into v_existing_fingerprint, v_purchase_id
    from private.purchase_idempotency pi
   where pi.actor_id = v_actor
     and pi.idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_existing_fingerprint <> v_fingerprint then
      raise exception 'Idempotency key was already used for a different request'
        using errcode = '23505';
    end if;
    return v_purchase_id;
  end if;

  if p_supplier_id is null or not exists (
    select 1 from public.suppliers s
     where s.id = p_supplier_id and s.active
  ) then
    raise exception 'An active supplier is required'
      using errcode = '23503';
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

  insert into private.purchase_idempotency (
    actor_id, idempotency_key, request_fingerprint, purchase_id
  )
  values (
    v_actor, p_idempotency_key, v_fingerprint, v_purchase_id
  );

  return v_purchase_id;
end;
$$;

revoke all on function public.create_purchase(uuid, date, jsonb, text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_purchase(uuid, date, jsonb, text, uuid)
  to authenticated;
