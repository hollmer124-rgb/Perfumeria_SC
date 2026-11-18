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
    -- Hold every component row through validation, using inventory lock order.
    perform m.id
      from public.materials as m
     where exists (
       select 1
         from public.recipe_components as rc
        where rc.recipe_id = new.id
          and rc.material_id = m.id
     )
     order by m.id
     for share of m;

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
          from public.recipe_components as rc
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

  -- Keep draft edits in the same recipe-before-reference lock order as activation.
  if p_recipe_id is not null then
    perform 1
      from public.recipes as r
     where r.id = p_recipe_id
     for update;
  end if;

  perform 1
    from public.perfumes as p
   where p.id = p_perfume_id
     and p.active
   for update;
  if not found then
    raise exception 'An active perfume is required'
      using errcode = '23503';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_components) as e(value)
     where jsonb_typeof(e.value) is distinct from 'object'
  ) then
    raise exception 'Recipe components must be JSON objects'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_components) as e(value)
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
      from jsonb_array_elements(p_components) as e(value)
     group by (e.value ->> 'material_id')::uuid
    having count(*) > 1
  ) then
    raise exception 'A material may only appear once in a recipe'
      using errcode = '22023';
  end if;

  if (
    select count(*) filter (where e.value ->> 'mode' = 'fill_to_volume')
      from jsonb_array_elements(p_components) as e(value)
  ) > 1 then
    raise exception 'A recipe can have at most one fill_to_volume component'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_components) as e(value)
      left join public.materials as m
        on m.id = (e.value ->> 'material_id')::uuid
     where m.id is null
        or not m.active
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
      from jsonb_array_elements(p_components) as e(value)
      join public.materials as m
        on m.id = (e.value ->> 'material_id')::uuid
     where e.value ->> 'mode' = 'fixed'
       and m.base_unit = 'ml'
    having sum((e.value ->> 'quantity')::numeric) >= p_size_ml
       and exists (
         select 1
           from jsonb_array_elements(p_components) as f(value)
          where f.value ->> 'mode' = 'fill_to_volume'
       )
  ) then
    raise exception 'Fixed ml components leave no positive fill volume'
      using errcode = '23514';
  end if;

  if p_recipe_id is null then
    select coalesce(max(r.version), 0) + 1
      into v_version
      from public.recipes as r
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
      from public.recipes as r
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
    from jsonb_array_elements(p_components) as e(value);

  return v_recipe_id;
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
   order by m.id, rc.id
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
     where rc.recipe_id = p_recipe_id
       and not m.active
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
             from public.recipe_components as fill_component
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
