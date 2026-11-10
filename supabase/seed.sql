-- DEMO / TEST DATA ONLY.
-- Loaded only by `supabase db reset` for local development. These records,
-- prices, quantities, names and the example recipe are fictitious and must
-- never be used as live inventory or production formula data.

insert into public.perfumes (id, name, brand, description, active)
values (
  'f0000000-0000-4000-8000-000000000001',
  'TEST ONLY - Fragancia ficticia',
  'TEST ONLY - Marca de demostracion',
  'Registro de prueba local; no representa un perfume real.',
  true
)
on conflict (id) do nothing;

insert into public.materials (
  id, name, base_unit, on_hand_qty, avg_unit_cost_cop, minimum_qty, active
)
values
  (
    'a0000000-0000-4000-8000-000000000001',
    'TEST ONLY - Esencia ficticia',
    'g', 0, 0, 0, true
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    'TEST ONLY - Alcohol ficticio',
    'ml', 0, 0, 0, true
  )
on conflict (id) do nothing;

insert into public.retail_products (
  id, perfume_id, product_type, sku, name, size_ml, price_cop,
  stock_qty, avg_unit_cost_cop, active
)
values (
  'b0000000-0000-4000-8000-000000000001',
  'f0000000-0000-4000-8000-000000000001',
  'original',
  'TEST-ONLY-ORIGINAL-001',
  'TEST ONLY - Producto ficticio sin existencias',
  30,
  1000,
  0,
  0,
  true
)
on conflict (id) do nothing;

insert into public.suppliers (id, name, notes, active)
values (
  'c0000000-0000-4000-8000-000000000001',
  'TEST ONLY - Proveedor ficticio',
  'Registro ficticio local; no contiene datos de contacto reales.',
  true
)
on conflict (id) do nothing;

insert into public.customers (id, full_name, notes)
values (
  'd0000000-0000-4000-8000-000000000001',
  'TEST ONLY - Cliente ficticio',
  'Registro ficticio local; no contiene datos personales reales.'
)
on conflict (id) do nothing;

insert into public.recipes (
  id, perfume_id, size_ml, version, status, price_cop
)
values (
  'e0000000-0000-4000-8000-000000000001',
  'f0000000-0000-4000-8000-000000000001',
  30,
  1,
  'draft',
  1000
)
on conflict (id) do nothing;

insert into public.recipe_components (id, recipe_id, material_id, mode, quantity)
values
  (
    'e1000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'fixed',
    1
  ),
  (
    'e1000000-0000-4000-8000-000000000002',
    'e0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002',
    'fill_to_volume',
    null
  )
on conflict (id) do nothing;

update public.recipes
   set status = 'active'
 where id = 'e0000000-0000-4000-8000-000000000001'
   and status = 'draft';
