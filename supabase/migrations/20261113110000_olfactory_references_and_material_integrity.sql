alter table public.materials
  drop constraint materials_category_reference_check,
  add constraint materials_category_reference_check
    check (
      (category = 'essence' and size_ml is null)
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

create or replace function private.validate_material_unit_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.base_unit is distinct from old.base_unit and (
    old.on_hand_qty <> 0
    or exists (
      select 1
        from public.recipe_components rc
       where rc.material_id = old.id
    )
    or exists (
      select 1
        from public.inventory_movements im
       where im.material_id = old.id
    )
    or exists (
      select 1
        from public.purchase_items pi
       where pi.material_id = old.id
    )
  ) then
    raise exception 'A material unit cannot change after it is used or stocked'
      using errcode = '55000';
  end if;

  if new.category is distinct from old.category
     and exists (
       select 1
         from public.recipe_components rc
        where rc.material_id = old.id
     ) then
    raise exception 'A material category used by a recipe cannot change'
      using errcode = '55000';
  end if;

  if new.size_ml is distinct from old.size_ml
     and (old.category = 'bottle' or new.category = 'bottle')
     and exists (
       select 1
         from public.recipe_components rc
        where rc.material_id = old.id
     ) then
    raise exception 'A bottle size used by a recipe cannot change'
      using errcode = '55000';
  end if;

  if old.active and not new.active and exists (
    select 1
      from public.recipe_components rc
      join public.recipes r on r.id = rc.recipe_id
     where rc.material_id = old.id
       and r.status = 'active'
  ) then
    raise exception 'A material used by an active recipe cannot be deactivated'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

drop trigger validate_material_unit_change on public.materials;
create trigger validate_material_unit_change
before update of base_unit, category, size_ml, active on public.materials
for each row execute function private.validate_material_unit_change();

create or replace function private.prevent_perfume_deactivation_with_active_recipes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.active and not new.active and exists (
    select 1
      from public.recipes r
     where r.perfume_id = old.id
       and r.status = 'active'
  ) then
    raise exception 'A reference with active recipes cannot be deactivated'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger prevent_perfume_deactivation_with_active_recipes
before update of active on public.perfumes
for each row execute function private.prevent_perfume_deactivation_with_active_recipes();

create or replace function private.lock_active_recipe_reference()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_reference_active boolean;
begin
  if new.status <> 'active' then
    return new;
  end if;

  select p.active
    into v_reference_active
    from public.perfumes p
   where p.id = new.perfume_id
   for share;

  if not found or not coalesce(v_reference_active, false) then
    raise exception 'An active recipe requires an active olfactory reference'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger lock_active_recipe_reference
before insert or update on public.recipes
for each row execute function private.lock_active_recipe_reference();

revoke all on function private.prevent_perfume_deactivation_with_active_recipes()
  from public, anon, authenticated;
revoke all on function private.lock_active_recipe_reference()
  from public, anon, authenticated;
