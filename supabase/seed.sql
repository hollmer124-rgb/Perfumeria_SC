-- DEMO ONLY: fictitious inventory and contacts for local testing.
-- This seed creates no auth.users, profiles, purchases, inventory movements, or sales.
-- Inventory stays at zero until it is received through the authenticated purchase RPC.
-- The Winner Sport recipe stays draft until an administrator activates it through
-- public.activate_recipe(uuid). Its price is 0 COP because no demo price was specified.
--
-- Run only against a local database after applying all migrations.

begin;

select private.begin_system_maintenance(
  'Load synthetic Perfumeria SC demo seed'
);

do $$
begin
  if exists (
    select 1
      from public.suppliers
     where id = any (array[
       '91000000-0000-4000-8000-000000000001'::uuid,
       '91000000-0000-4000-8000-000000000002'::uuid,
       '91000000-0000-4000-8000-000000000003'::uuid
     ])
       and name not like 'DEMO - %'
  ) then
    raise exception 'A deterministic demo supplier ID belongs to a non-demo row';
  end if;

  if exists (
    select 1
      from public.perfumes
     where id = any (array[
       '92000000-0000-4000-8000-000000000001'::uuid,
       '92000000-0000-4000-8000-000000000002'::uuid,
       '92000000-0000-4000-8000-000000000003'::uuid,
       '92000000-0000-4000-8000-000000000004'::uuid,
       '92000000-0000-4000-8000-000000000005'::uuid,
       '92000000-0000-4000-8000-000000000006'::uuid,
       '92000000-0000-4000-8000-000000000007'::uuid,
       '92000000-0000-4000-8000-000000000008'::uuid,
       '92000000-0000-4000-8000-000000000009'::uuid,
       '92000000-0000-4000-8000-000000000010'::uuid
     ])
       and (name not like 'DEMO - %' or brand not like 'DEMO - %')
  ) then
    raise exception 'A deterministic demo perfume ID belongs to a non-demo row';
  end if;

  if exists (
    select 1
      from public.retail_products
     where id = any (array[
       '93000000-0000-4000-8000-000000000001'::uuid,
       '93000000-0000-4000-8000-000000000002'::uuid,
       '93000000-0000-4000-8000-000000000003'::uuid,
       '93000000-0000-4000-8000-000000000004'::uuid,
       '93000000-0000-4000-8000-000000000005'::uuid,
       '93000000-0000-4000-8000-000000000006'::uuid,
       '93000000-0000-4000-8000-000000000007'::uuid,
       '93000000-0000-4000-8000-000000000008'::uuid,
       '93000000-0000-4000-8000-000000000009'::uuid,
       '93000000-0000-4000-8000-000000000010'::uuid
     ])
       and (name not like 'DEMO - %' or sku not like 'DEMO-%')
  ) then
    raise exception 'A deterministic demo product ID belongs to a non-demo row';
  end if;

  if exists (
    select 1
      from public.materials
     where id = any (array[
       '94000000-0000-4000-8000-000000000001'::uuid,
       '94000000-0000-4000-8000-000000000002'::uuid,
       '94000000-0000-4000-8000-000000000003'::uuid,
       '94000000-0000-4000-8000-000000000004'::uuid,
       '94000000-0000-4000-8000-000000000005'::uuid,
       '94000000-0000-4000-8000-000000000006'::uuid,
       '94000000-0000-4000-8000-000000000007'::uuid,
       '94000000-0000-4000-8000-000000000008'::uuid,
       '94000000-0000-4000-8000-000000000009'::uuid,
       '94000000-0000-4000-8000-000000000010'::uuid,
       '94000000-0000-4000-8000-000000000011'::uuid,
       '94000000-0000-4000-8000-000000000012'::uuid,
       '94000000-0000-4000-8000-000000000013'::uuid,
       '94000000-0000-4000-8000-000000000014'::uuid
     ])
       and name not like 'DEMO - %'
  ) then
    raise exception 'A deterministic demo material ID belongs to a non-demo row';
  end if;

  if exists (
    select 1
      from public.customers
     where id = any (array[
       '96000000-0000-4000-8000-000000000001'::uuid,
       '96000000-0000-4000-8000-000000000002'::uuid,
       '96000000-0000-4000-8000-000000000003'::uuid,
       '96000000-0000-4000-8000-000000000004'::uuid,
       '96000000-0000-4000-8000-000000000005'::uuid,
       '96000000-0000-4000-8000-000000000006'::uuid,
       '96000000-0000-4000-8000-000000000007'::uuid,
       '96000000-0000-4000-8000-000000000008'::uuid
     ])
       and full_name not like 'DEMO - %'
  ) then
    raise exception 'A deterministic demo customer ID belongs to a non-demo row';
  end if;

  if exists (
    select 1
      from public.recipes
     where id = '95000000-0000-4000-8000-000000000001'::uuid
       and (
         perfume_id <> '92000000-0000-4000-8000-000000000006'::uuid
         or size_ml <> 30
         or version <> 1
       )
  ) then
    raise exception 'The deterministic demo recipe ID belongs to another recipe';
  end if;

  if exists (
    select 1
      from public.recipe_components rc
     where rc.id = any (array[
       '95100000-0000-4000-8000-000000000001'::uuid,
       '95100000-0000-4000-8000-000000000002'::uuid,
       '95100000-0000-4000-8000-000000000003'::uuid,
       '95100000-0000-4000-8000-000000000004'::uuid
     ])
       and not (
         rc.recipe_id = '95000000-0000-4000-8000-000000000001'::uuid
         and (
           (rc.id = '95100000-0000-4000-8000-000000000001'::uuid
             and rc.material_id = '94000000-0000-4000-8000-000000000001'::uuid
             and rc.mode = 'fixed' and rc.quantity = 15)
           or (rc.id = '95100000-0000-4000-8000-000000000002'::uuid
             and rc.material_id = '94000000-0000-4000-8000-000000000010'::uuid
             and rc.mode = 'fixed' and rc.quantity = 1)
           or (rc.id = '95100000-0000-4000-8000-000000000003'::uuid
             and rc.material_id = '94000000-0000-4000-8000-000000000009'::uuid
             and rc.mode = 'fill_to_volume' and rc.quantity is null)
           or (rc.id = '95100000-0000-4000-8000-000000000004'::uuid
             and rc.material_id = '94000000-0000-4000-8000-000000000011'::uuid
             and rc.mode = 'fixed' and rc.quantity = 1)
         )
       )
  ) then
    raise exception 'A deterministic demo component ID belongs to another recipe component';
  end if;
end;
$$;

insert into public.suppliers (id, name, notes, active)
values
  (
    '91000000-0000-4000-8000-000000000001',
    'DEMO - Abastecedor Botánico',
    'Proveedor sintético para pruebas; sin datos de contacto reales.',
    true
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    'DEMO - Suministros de Esencias',
    'Proveedor sintético para pruebas; sin datos de contacto reales.',
    true
  ),
  (
    '91000000-0000-4000-8000-000000000003',
    'DEMO - Envases de Laboratorio',
    'Proveedor sintético para pruebas; sin datos de contacto reales.',
    true
  )
on conflict (id) do nothing;

insert into public.perfumes (id, name, brand, description, active)
values
  ('92000000-0000-4000-8000-000000000001', 'DEMO - Brisa de Cedro', 'DEMO - Casa Ámbar', 'Perfume sintético para pruebas locales; no es una referencia comercial.', true),
  ('92000000-0000-4000-8000-000000000002', 'DEMO - Noche de Azahar', 'DEMO - Casa Ámbar', 'Perfume sintético para pruebas locales; no es una referencia comercial.', true),
  ('92000000-0000-4000-8000-000000000003', 'DEMO - Té de Lluvia', 'DEMO - Taller Botánico', 'Perfume sintético para pruebas locales; no es una referencia comercial.', true),
  ('92000000-0000-4000-8000-000000000004', 'DEMO - Madera Serena', 'DEMO - Taller Botánico', 'Perfume sintético para pruebas locales; no es una referencia comercial.', true),
  ('92000000-0000-4000-8000-000000000005', 'DEMO - Flor de Nube', 'DEMO - Estudio Brisa', 'Perfume sintético para pruebas locales; no es una referencia comercial.', true),
  ('92000000-0000-4000-8000-000000000006', 'DEMO - Winner Sport', 'DEMO - Estudio Brisa', 'Nombre de prueba solicitado; los datos son ficticios y no representan una marca comercial.', true),
  ('92000000-0000-4000-8000-000000000007', 'DEMO - Cítrico Claro', 'DEMO - Casa Ámbar', 'Perfume sintético para pruebas locales; no es una referencia comercial.', true),
  ('92000000-0000-4000-8000-000000000008', 'DEMO - Jardín Verde', 'DEMO - Taller Botánico', 'Perfume sintético para pruebas locales; no es una referencia comercial.', true),
  ('92000000-0000-4000-8000-000000000009', 'DEMO - Niebla de Vainilla', 'DEMO - Estudio Brisa', 'Perfume sintético para pruebas locales; no es una referencia comercial.', true),
  ('92000000-0000-4000-8000-000000000010', 'DEMO - Sal Marina', 'DEMO - Casa Ámbar', 'Perfume sintético para pruebas locales; no es una referencia comercial.', true)
on conflict (id) do nothing;

insert into public.retail_products (
  id, perfume_id, product_type, sku, name, size_ml, price_cop, stock_qty,
  avg_unit_cost_cop, active, brand, supplier_id, minimum_qty
)
values
  ('93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'original', 'DEMO-ORI-001', 'DEMO - Brisa de Cedro · Original 30 ml', 30, 120000, 0, 0, true, 'DEMO - Casa Ámbar', '91000000-0000-4000-8000-000000000001', 2),
  ('93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', 'original', 'DEMO-ORI-002', 'DEMO - Noche de Azahar · Original 50 ml', 50, 165000, 0, 0, true, 'DEMO - Casa Ámbar', '91000000-0000-4000-8000-000000000001', 2),
  ('93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000003', 'original', 'DEMO-ORI-003', 'DEMO - Té de Lluvia · Original 60 ml', 60, 190000, 0, 0, true, 'DEMO - Taller Botánico', '91000000-0000-4000-8000-000000000002', 1),
  ('93000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000004', 'original', 'DEMO-ORI-004', 'DEMO - Madera Serena · Original 100 ml', 100, 245000, 0, 0, true, 'DEMO - Taller Botánico', '91000000-0000-4000-8000-000000000002', 1),
  ('93000000-0000-4000-8000-000000000005', '92000000-0000-4000-8000-000000000005', 'original', 'DEMO-ORI-005', 'DEMO - Flor de Nube · Original 30 ml', 30, 135000, 0, 0, true, 'DEMO - Estudio Brisa', '91000000-0000-4000-8000-000000000001', 2),
  ('93000000-0000-4000-8000-000000000006', '92000000-0000-4000-8000-000000000006', '1.1', 'DEMO-11-001', 'DEMO - Winner Sport · 1.1 30 ml', 30, 35000, 0, 0, true, 'DEMO - Estudio Brisa', '91000000-0000-4000-8000-000000000002', 3),
  ('93000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000007', '1.1', 'DEMO-11-002', 'DEMO - Cítrico Claro · 1.1 50 ml', 50, 42000, 0, 0, true, 'DEMO - Casa Ámbar', '91000000-0000-4000-8000-000000000002', 3),
  ('93000000-0000-4000-8000-000000000008', '92000000-0000-4000-8000-000000000008', '1.1', 'DEMO-11-003', 'DEMO - Jardín Verde · 1.1 60 ml', 60, 48000, 0, 0, true, 'DEMO - Taller Botánico', '91000000-0000-4000-8000-000000000002', 3),
  ('93000000-0000-4000-8000-000000000009', '92000000-0000-4000-8000-000000000009', '1.1', 'DEMO-11-004', 'DEMO - Niebla de Vainilla · 1.1 100 ml', 100, 58000, 0, 0, true, 'DEMO - Estudio Brisa', '91000000-0000-4000-8000-000000000003', 2),
  ('93000000-0000-4000-8000-000000000010', '92000000-0000-4000-8000-000000000010', '1.1', 'DEMO-11-005', 'DEMO - Sal Marina · 1.1 30 ml', 30, 32000, 0, 0, true, 'DEMO - Casa Ámbar', '91000000-0000-4000-8000-000000000002', 3)
on conflict (id) do nothing;

insert into public.materials (
  id, name, base_unit, minimum_qty, active, category, perfume_id,
  supplier_id, size_ml
)
values
  ('94000000-0000-4000-8000-000000000001', 'DEMO - Esencia Winner Sport', 'g', 30, true, 'essence', '92000000-0000-4000-8000-000000000006', '91000000-0000-4000-8000-000000000002', null),
  ('94000000-0000-4000-8000-000000000002', 'DEMO - Esencia Brisa de Cedro', 'g', 30, true, 'essence', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', null),
  ('94000000-0000-4000-8000-000000000003', 'DEMO - Esencia Noche de Azahar', 'g', 30, true, 'essence', '92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', null),
  ('94000000-0000-4000-8000-000000000004', 'DEMO - Esencia Té de Lluvia', 'g', 30, true, 'essence', '92000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000002', null),
  ('94000000-0000-4000-8000-000000000005', 'DEMO - Esencia Madera Serena', 'g', 30, true, 'essence', '92000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000002', null),
  ('94000000-0000-4000-8000-000000000006', 'DEMO - Esencia Flor de Nube', 'g', 30, true, 'essence', '92000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000002', null),
  ('94000000-0000-4000-8000-000000000007', 'DEMO - Esencia Cítrico Claro', 'g', 30, true, 'essence', '92000000-0000-4000-8000-000000000007', '91000000-0000-4000-8000-000000000002', null),
  ('94000000-0000-4000-8000-000000000008', 'DEMO - Esencia Jardín Verde', 'g', 30, true, 'essence', '92000000-0000-4000-8000-000000000008', '91000000-0000-4000-8000-000000000002', null),
  ('94000000-0000-4000-8000-000000000009', 'DEMO - Alcohol perfumero sintético', 'ml', 500, true, 'alcohol', null, '91000000-0000-4000-8000-000000000001', null),
  ('94000000-0000-4000-8000-000000000010', 'DEMO - Feromonas sintéticas', 'dose', 10, true, 'pheromone', null, '91000000-0000-4000-8000-000000000001', null),
  ('94000000-0000-4000-8000-000000000011', 'DEMO - Frasco atomizador 30 ml', 'unit', 5, true, 'bottle', null, '91000000-0000-4000-8000-000000000003', 30),
  ('94000000-0000-4000-8000-000000000012', 'DEMO - Frasco atomizador 50 ml', 'unit', 5, true, 'bottle', null, '91000000-0000-4000-8000-000000000003', 50),
  ('94000000-0000-4000-8000-000000000013', 'DEMO - Frasco atomizador 60 ml', 'unit', 5, true, 'bottle', null, '91000000-0000-4000-8000-000000000003', 60),
  ('94000000-0000-4000-8000-000000000014', 'DEMO - Frasco atomizador 100 ml', 'unit', 5, true, 'bottle', null, '91000000-0000-4000-8000-000000000003', 100)
on conflict (id) do nothing;

insert into public.customers (id, full_name, notes)
values
  ('96000000-0000-4000-8000-000000000001', 'DEMO - Cliente 01', 'Registro sintético para pruebas; sin datos personales.'),
  ('96000000-0000-4000-8000-000000000002', 'DEMO - Cliente 02', 'Registro sintético para pruebas; sin datos personales.'),
  ('96000000-0000-4000-8000-000000000003', 'DEMO - Cliente 03', 'Registro sintético para pruebas; sin datos personales.'),
  ('96000000-0000-4000-8000-000000000004', 'DEMO - Cliente 04', 'Registro sintético para pruebas; sin datos personales.'),
  ('96000000-0000-4000-8000-000000000005', 'DEMO - Cliente 05', 'Registro sintético para pruebas; sin datos personales.'),
  ('96000000-0000-4000-8000-000000000006', 'DEMO - Cliente 06', 'Registro sintético para pruebas; sin datos personales.'),
  ('96000000-0000-4000-8000-000000000007', 'DEMO - Cliente 07', 'Registro sintético para pruebas; sin datos personales.'),
  ('96000000-0000-4000-8000-000000000008', 'DEMO - Cliente 08', 'Registro sintético para pruebas; sin datos personales.')
on conflict (id) do nothing;

insert into public.recipes (
  id, perfume_id, size_ml, version, status, price_cop, created_by
)
values (
  '95000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000006',
  30,
  1,
  'draft',
  0,
  null
)
on conflict (id) do nothing;

insert into public.recipe_components (id, recipe_id, material_id, mode, quantity)
values
  (
    '95100000-0000-4000-8000-000000000001',
    '95000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000001',
    'fixed',
    15
  ),
  (
    '95100000-0000-4000-8000-000000000002',
    '95000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000010',
    'fixed',
    1
  ),
  (
    '95100000-0000-4000-8000-000000000003',
    '95000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000009',
    'fill_to_volume',
    null
  ),
  (
    '95100000-0000-4000-8000-000000000004',
    '95000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000011',
    'fixed',
    1
  )
on conflict (id) do nothing;

do $$
begin
  if (
    select count(*) from public.suppliers
     where id = any (array[
       '91000000-0000-4000-8000-000000000001'::uuid,
       '91000000-0000-4000-8000-000000000002'::uuid,
       '91000000-0000-4000-8000-000000000003'::uuid
     ])
  ) <> 3 then
    raise exception 'Demo seed integrity check failed for suppliers';
  end if;
  if (
    select count(*) from public.perfumes
     where id between '92000000-0000-4000-8000-000000000001'::uuid
                  and '92000000-0000-4000-8000-000000000010'::uuid
       and name like 'DEMO - %'
       and brand like 'DEMO - %'
  ) <> 10 then
    raise exception 'Demo seed integrity check failed for perfumes';
  end if;
  if (
    select count(*) from public.retail_products
     where id between '93000000-0000-4000-8000-000000000001'::uuid
                  and '93000000-0000-4000-8000-000000000010'::uuid
       and sku like 'DEMO-%'
       and name like 'DEMO - %'
  ) <> 10 then
    raise exception 'Demo seed integrity check failed for retail products';
  end if;
  if (
    select count(*) from public.retail_products
     where id between '93000000-0000-4000-8000-000000000001'::uuid
                  and '93000000-0000-4000-8000-000000000005'::uuid
       and product_type = 'original'
  ) <> 5 or (
    select count(*) from public.retail_products
     where id between '93000000-0000-4000-8000-000000000006'::uuid
                  and '93000000-0000-4000-8000-000000000010'::uuid
       and product_type = '1.1'
  ) <> 5 then
    raise exception 'Demo seed integrity check failed for product types';
  end if;
  if (
    select count(*) from public.materials
     where id between '94000000-0000-4000-8000-000000000001'::uuid
                  and '94000000-0000-4000-8000-000000000014'::uuid
       and name like 'DEMO - %'
  ) <> 14 then
    raise exception 'Demo seed integrity check failed for materials';
  end if;
  if (
    select count(*) from public.materials
     where id between '94000000-0000-4000-8000-000000000001'::uuid
                  and '94000000-0000-4000-8000-000000000008'::uuid
       and category = 'essence'
       and base_unit = 'g'
       and perfume_id is not null
  ) <> 8 or not exists (
    select 1 from public.materials
     where id = '94000000-0000-4000-8000-000000000009'::uuid
       and category = 'alcohol' and base_unit = 'ml'
  ) or not exists (
    select 1 from public.materials
     where id = '94000000-0000-4000-8000-000000000010'::uuid
       and category = 'pheromone' and base_unit = 'dose'
  ) or (
    select count(*) from public.materials
     where id between '94000000-0000-4000-8000-000000000011'::uuid
                  and '94000000-0000-4000-8000-000000000014'::uuid
       and category = 'bottle'
       and base_unit = 'unit'
       and size_ml in (30, 50, 60, 100)
  ) <> 4 then
    raise exception 'Demo seed integrity check failed for material categories and units';
  end if;
  if (
    select count(*) from public.customers
     where id between '96000000-0000-4000-8000-000000000001'::uuid
                  and '96000000-0000-4000-8000-000000000008'::uuid
       and full_name like 'DEMO - %'
  ) <> 8 then
    raise exception 'Demo seed integrity check failed for customers';
  end if;
  if (
    select count(*) from public.recipe_components
     where id between '95100000-0000-4000-8000-000000000001'::uuid
                  and '95100000-0000-4000-8000-000000000004'::uuid
       and recipe_id = '95000000-0000-4000-8000-000000000001'::uuid
  ) <> 4 then
    raise exception 'Demo seed integrity check failed for the Winner Sport formula';
  end if;
end;
$$;

select private.end_system_maintenance();

commit;
