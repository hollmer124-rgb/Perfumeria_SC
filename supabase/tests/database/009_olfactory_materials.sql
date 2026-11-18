-- Local pgTAP coverage for independent olfactory references and inventory materials.
create extension if not exists pgtap with schema extensions;

begin;

select plan(54);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '97000000-0000-4000-8000-000000000061',
    'authenticated',
    'authenticated',
    'olfactory-test-admin@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '97000000-0000-4000-8000-000000000062',
    'authenticated',
    'authenticated',
    'olfactory-test-employee@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  );

select private.begin_system_maintenance(
  'pgtap olfactory reference and material fixtures'
);

insert into public.profiles (id, role, display_name)
values
  ('97000000-0000-4000-8000-000000000061', 'admin', 'Olfactory test admin'),
  ('97000000-0000-4000-8000-000000000062', 'employee', 'Olfactory test employee');

insert into public.suppliers (id, name, active)
values (
  '98400000-0000-4000-8000-000000000001',
  'Proveedor de referencia olfativa',
  true
);

insert into public.perfumes (id, name, brand, description, active)
values (
  '98100000-0000-4000-8000-000000000001',
  'Aroma técnico de prueba',
  'Marca técnica',
  'Referencia para pruebas locales.',
  true
);

insert into public.materials (
  id, name, base_unit, category, perfume_id, size_ml, active
)
values
  (
    '98200000-0000-4000-8000-000000000001',
    'Esencia compartida sin referencia',
    'g', 'essence', null, null, true
  ),
  (
    '98200000-0000-4000-8000-000000000002',
    'Frasco de prueba 30 ml',
    'unit', 'bottle', null, 30, true
  ),
  (
    '98200000-0000-4000-8000-000000000003',
    'Frasco de prueba 50 ml',
    'unit', 'bottle', null, 50, true
  ),
  (
    '98200000-0000-4000-8000-000000000004',
    'Frasco de prueba sin receta',
    'unit', 'bottle', null, 30, true
  ),
  (
    '98200000-0000-4000-8000-000000000005',
    'Material de prueba sin receta',
    'dose', 'other', null, null, true
  ),
  (
    '98200000-0000-4000-8000-000000000007',
    'Material inactivo para activación directa',
    'dose', 'other', null, null, true
  );

insert into public.recipes (
  id, perfume_id, size_ml, version, status, price_cop
)
values
  (
    '98300000-0000-4000-8000-000000000001',
    '98100000-0000-4000-8000-000000000001',
    30, 1, 'draft', 100
  ),
  (
    '98300000-0000-4000-8000-000000000002',
    '98100000-0000-4000-8000-000000000001',
    50, 1, 'draft', 150
  ),
  (
    '98300000-0000-4000-8000-000000000003',
    '98100000-0000-4000-8000-000000000001',
    50, 2, 'draft', 150
  ),
  (
    '98300000-0000-4000-8000-000000000004',
    '98100000-0000-4000-8000-000000000001',
    30, 2, 'draft', 100
  );

insert into public.recipe_components (recipe_id, material_id, mode, quantity)
values
  (
    '98300000-0000-4000-8000-000000000001',
    '98200000-0000-4000-8000-000000000001',
    'fixed', 1
  ),
  (
    '98300000-0000-4000-8000-000000000001',
    '98200000-0000-4000-8000-000000000002',
    'fixed', 1
  ),
  (
    '98300000-0000-4000-8000-000000000002',
    '98200000-0000-4000-8000-000000000001',
    'fixed', 2
  ),
  (
    '98300000-0000-4000-8000-000000000002',
    '98200000-0000-4000-8000-000000000003',
    'fixed', 1
  ),
  (
    '98300000-0000-4000-8000-000000000003',
    '98200000-0000-4000-8000-000000000007',
    'fixed', 1
  ),
  (
    '98300000-0000-4000-8000-000000000003',
    '98200000-0000-4000-8000-000000000003',
    'fixed', 1
  ),
  (
    '98300000-0000-4000-8000-000000000004',
    '98200000-0000-4000-8000-000000000002',
    'fixed', 1
  );

update public.recipes
   set status = 'active'
 where id in (
   '98300000-0000-4000-8000-000000000001',
   '98300000-0000-4000-8000-000000000002'
 );

select private.end_system_maintenance();

select ok(
  (select relrowsecurity from pg_class where oid = 'public.perfumes'::regclass),
  'olfactory references remain protected by RLS'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.materials'::regclass),
  'inventory materials remain protected by RLS'
);

select is(
  (select perfume_id from public.materials
    where id = '98200000-0000-4000-8000-000000000001'),
  null::uuid,
  'an essence can have no olfactory reference'
);

select is(
  (select count(*) from public.materials
    where id = '98200000-0000-4000-8000-000000000001'),
  1::bigint,
  'a shared essence remains one inventory record'
);

select is(
  (select count(*) from public.recipe_components
    where material_id = '98200000-0000-4000-8000-000000000001'),
  2::bigint,
  'the same essence can be used by multiple recipes'
);

select is(
  (select on_hand_qty from public.materials
    where id = '98200000-0000-4000-8000-000000000001'),
  0::numeric,
  'linking an essence to recipes does not duplicate its stock'
);

select throws_ok(
  $$insert into public.materials (name, base_unit, category, perfume_id)
    values ('Invalid fragrance reference material', 'g', 'essence',
      '98900000-0000-4000-8000-000000000001')$$,
  '23503',
  'insert or update on table "materials" violates foreign key constraint "materials_perfume_id_fkey"',
  'the perfume foreign key still rejects missing references'
);

select throws_ok(
  $$insert into public.materials (name, base_unit, category, perfume_id)
    values (
      'Invalid non-essence reference material', 'ml', 'alcohol',
      '98100000-0000-4000-8000-000000000001'
    )$$,
  '23514',
  'new row for relation "materials" violates check constraint "materials_category_reference_check"',
  'non-essence materials cannot link to an olfactory reference'
);

select throws_ok(
  $$insert into public.materials (name, base_unit, category, size_ml)
    values ('Invalid bottle size', 'unit', 'bottle', 40)$$,
  '23514',
  'new row for relation "materials" violates check constraint "materials_size_ml_check"',
  'bottle presentation sizes remain restricted to configured values'
);

select throws_ok(
  $$insert into public.materials (name, base_unit, category, size_ml)
    values ('Invalid bottle unit', 'ml', 'bottle', 30)$$,
  '23514',
  'new row for relation "materials" violates check constraint "materials_category_reference_check"',
  'bottles remain controlled in whole units'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000061',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000061","role":"authenticated"}',
  true
);

select lives_ok(
  $$insert into public.perfumes (
      id, name, brand, description, active
    )
    values (
      '98100000-0000-4000-8000-000000000002',
      'Referencia independiente',
      'Marca independiente',
      'Creada sin producto comercial.',
      true
    )$$,
  'an administrator can create a reference independently of products'
);

select is(
  (select count(*) from public.retail_products
    where perfume_id = '98100000-0000-4000-8000-000000000002'),
  0::bigint,
  'creating an olfactory reference creates no finished product'
);

select lives_ok(
  $$update public.perfumes
       set name = 'Referencia independiente editada',
           description = 'Descripción editada.'
     where id = '98100000-0000-4000-8000-000000000002'$$,
  'an administrator can edit reference name and description'
);

select is(
  (select name from public.perfumes
    where id = '98100000-0000-4000-8000-000000000002'),
  'Referencia independiente editada',
  'the edited reference persists'
);

select throws_ok(
  $$insert into public.perfumes (name, brand, active)
    values ('Referencia independiente editada', 'Marca independiente', true)$$,
  '23505',
  'duplicate key value violates unique constraint "perfumes_brand_name_key"',
  'the existing brand and name uniqueness prevents exact duplicates'
);

select lives_ok(
  $$select public.admin_save_retail_product(
      null,
      'Referencia independiente editada',
      'Marca independiente',
      'original'::public.retail_product_type,
      'TEST-REFERENCE-INACTIVE',
      30,
      1000,
      0,
      '98400000-0000-4000-8000-000000000001',
      true
    )$$,
  'an existing reference can be reused by a commercial product'
);

select lives_ok(
  $$update public.perfumes set active = false
      where id = '98100000-0000-4000-8000-000000000002'$$,
  'a reference without active recipes can be deactivated'
);

select is(
  (select active from public.retail_products
    where sku = 'TEST-REFERENCE-INACTIVE'),
  true,
  'deactivating the reference does not disable a commercial product'
);

select throws_ok(
  $$update public.perfumes set active = false
      where id = '98100000-0000-4000-8000-000000000001'$$,
  '55000',
  'A reference with active recipes cannot be deactivated',
  'an olfactory reference with active recipes cannot be deactivated'
);

select is(
  (select active from public.perfumes
    where id = '98100000-0000-4000-8000-000000000001'),
  true,
  'the blocked deactivation leaves the reference active'
);

select is(
  (select count(*) from public.recipes
    where perfume_id = '98100000-0000-4000-8000-000000000001'
      and status = 'active'),
  2::bigint,
  'active recipes remain usable after the blocked deactivation'
);

select lives_ok(
  $$select public.admin_save_retail_product(
      null,
      'Aroma técnico de prueba',
      'Marca técnica',
      'original'::public.retail_product_type,
      'TEST-REFERENCE-REUSE',
      30,
      1000,
      0,
      '98400000-0000-4000-8000-000000000001',
      true
    )$$,
  'the existing product flow can reuse an olfactory reference'
);

select is(
  (select count(*) from public.perfumes
    where name = 'Aroma técnico de prueba' and brand = 'Marca técnica'),
  1::bigint,
  'saving a product with an existing reference does not duplicate it'
);

select is(
  (select perfume_id from public.retail_products
    where sku = 'TEST-REFERENCE-REUSE'),
  '98100000-0000-4000-8000-000000000001'::uuid,
  'the commercial product links to the existing reference'
);

select lives_ok(
  $$insert into public.materials (
      name, base_unit, category, perfume_id, minimum_qty, active
    )
    values (
      'Esencia creada desde formulario sin referencia',
      'g', 'essence', null, 0, true
    )$$,
  'an administrator can create an essence without a reference'
);

select is(
  (select perfume_id from public.materials
    where name = 'Esencia creada desde formulario sin referencia'),
  null::uuid,
  'the newly created essence stores a null reference'
);

select lives_ok(
  $$select public.admin_save_recipe(
      '98300000-0000-4000-8000-000000000004',
      '98100000-0000-4000-8000-000000000001',
      30,
      175,
      '[
        {"material_id":"98200000-0000-4000-8000-000000000001","mode":"fixed","quantity":3},
        {"material_id":"98200000-0000-4000-8000-000000000002","mode":"fixed","quantity":1}
      ]'::jsonb
    )$$,
  'an administrator can still edit an existing draft recipe'
);

select ok(
  (select price_cop = 175
     from public.recipes
    where id = '98300000-0000-4000-8000-000000000004')
  and (select quantity = 3
         from public.recipe_components
        where recipe_id = '98300000-0000-4000-8000-000000000004'
          and material_id = '98200000-0000-4000-8000-000000000001'),
  'draft recipe edits preserve the requested price and component quantity'
);

select throws_ok(
  $$insert into public.recipe_components (recipe_id, material_id, mode, quantity)
    values (
      '98300000-0000-4000-8000-000000000001',
      '98200000-0000-4000-8000-000000000005',
      'fixed', 1
    )$$,
  '55000',
  'Only draft recipe versions can be edited',
  'an active recipe rejects a direct component insert'
);

select throws_ok(
  $$update public.recipe_components
       set quantity = quantity + 1
     where recipe_id = '98300000-0000-4000-8000-000000000001'
       and material_id = '98200000-0000-4000-8000-000000000001'$$,
  '55000',
  'Only draft recipe versions can be edited',
  'an active recipe rejects an in-place component update'
);

select throws_ok(
  $$update public.recipe_components
       set recipe_id = '98300000-0000-4000-8000-000000000004'
     where recipe_id = '98300000-0000-4000-8000-000000000001'
       and material_id = '98200000-0000-4000-8000-000000000001'$$,
  '55000',
  'Only draft recipe versions can be edited',
  'a component cannot be moved out of an active recipe'
);

select lives_ok(
  $$insert into public.recipe_components (recipe_id, material_id, mode, quantity)
    values (
      '98300000-0000-4000-8000-000000000003',
      '98200000-0000-4000-8000-000000000005',
      'fixed', 1
    )$$,
  'a component can be inserted into a draft recipe'
);

select lives_ok(
  $$update public.recipe_components
       set quantity = 2
     where recipe_id = '98300000-0000-4000-8000-000000000003'
       and material_id = '98200000-0000-4000-8000-000000000005'$$,
  'a draft recipe component can be updated in place'
);

select throws_ok(
  $$update public.recipe_components
       set recipe_id = '98300000-0000-4000-8000-000000000001'
     where recipe_id = '98300000-0000-4000-8000-000000000003'
       and material_id = '98200000-0000-4000-8000-000000000005'$$,
  '55000',
  'Only draft recipe versions can be edited',
  'a component cannot be moved into an active recipe'
);

select lives_ok(
  $$delete from public.recipe_components
     where recipe_id = '98300000-0000-4000-8000-000000000003'
       and material_id = '98200000-0000-4000-8000-000000000005'$$,
  'a component can be deleted from a draft recipe'
);

select throws_ok(
  $$delete from public.recipe_components
     where recipe_id = '98300000-0000-4000-8000-000000000001'
       and material_id = '98200000-0000-4000-8000-000000000001'$$,
  '55000',
  'Only draft recipe versions can be edited',
  'an active recipe rejects a component delete'
);

select lives_ok(
  $$update public.materials set active = false
      where id = '98200000-0000-4000-8000-000000000007'$$,
  'a material can be deactivated while its recipe is still a draft'
);

select throws_ok(
  $$select public.activate_recipe(
      '98300000-0000-4000-8000-000000000003'
    )$$,
  '23514',
  'All recipe component materials must be active',
  'the activation RPC rejects a recipe with an inactive material'
);

select throws_ok(
  $$update public.recipes set status = 'active'
      where id = '98300000-0000-4000-8000-000000000003'$$,
  '23514',
  'All recipe component materials must be active',
  'direct recipe status updates reject activation with an inactive material'
);

select is(
  (select status::text from public.recipes
    where id = '98300000-0000-4000-8000-000000000003'),
  'draft',
  'failed direct activation leaves the recipe in draft'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000062',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000062","role":"authenticated"}',
  true
);

select throws_ok(
  $$insert into public.perfumes (name, brand, active)
    values ('Employee cannot create', 'Employee test', true)$$,
  '42501',
  'new row violates row-level security policy for table "perfumes"',
  'an employee cannot create olfactory references'
);

select lives_ok(
  $tap$do $employee_update$
    declare
      affected_rows bigint;
    begin
      update public.perfumes
         set description = 'Employee must not change this.'
       where id = '98100000-0000-4000-8000-000000000001';
      get diagnostics affected_rows = row_count;
      if affected_rows <> 0 then
        raise exception 'An employee updated an olfactory reference';
      end if;
    end;
  $employee_update$ $tap$,
  'an employee cannot update olfactory references'
);

select is(
  (select description from public.perfumes
    where id = '98100000-0000-4000-8000-000000000001'),
  'Referencia para pruebas locales.',
  'employee update attempts leave the reference unchanged'
);

select is(
  (select count(*) from public.perfumes
    where id = '98100000-0000-4000-8000-000000000001'),
  1::bigint,
  'an employee can read active olfactory references'
);

select is(
  (select count(*) from public.materials
    where id = '98200000-0000-4000-8000-000000000001'),
  1::bigint,
  'an employee retains read access to active operational material'
);

select ok(
  not has_column_privilege(
    'authenticated', 'public.materials', 'avg_unit_cost_cop', 'SELECT'
  ),
  'employee material reads do not expose average costs'
);

reset role;
set local role anon;
select throws_ok(
  $$insert into public.perfumes (name, brand, active)
    values ('Anonymous cannot create', 'Anonymous test', true)$$,
  '42501',
  'permission denied for table perfumes',
  'an anonymous user cannot create olfactory references'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000061',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000061","role":"authenticated"}',
  true
);

select throws_ok(
  $$update public.materials set base_unit = 'ml'
      where id = '98200000-0000-4000-8000-000000000001'$$,
  '55000',
  'A material unit cannot change after it is used or stocked',
  'a material unit used by recipes cannot change'
);

select throws_ok(
  $$update public.materials set category = 'other'
      where id = '98200000-0000-4000-8000-000000000001'$$,
  '55000',
  'A material category used by a recipe cannot change',
  'a material category used by recipes cannot change'
);

select throws_ok(
  $$update public.materials set size_ml = 50
      where id = '98200000-0000-4000-8000-000000000002'$$,
  '55000',
  'A bottle size used by a recipe cannot change',
  'a bottle presentation used by a recipe cannot change'
);

select throws_ok(
  $$update public.materials set category = 'other'
      where id = '98200000-0000-4000-8000-000000000002'$$,
  '55000',
  'A material category used by a recipe cannot change',
  'a recipe bottle cannot be reclassified'
);

select throws_ok(
  $$update public.materials set active = false
      where id = '98200000-0000-4000-8000-000000000001'$$,
  '55000',
  'A material used by an active recipe cannot be deactivated',
  'a material used by an active recipe cannot be deactivated'
);

select lives_ok(
  $$update public.materials set category = 'pheromone'
      where id = '98200000-0000-4000-8000-000000000005'$$,
  'category changes remain allowed when they do not affect a recipe'
);

select lives_ok(
  $$update public.materials set size_ml = 50
      where id = '98200000-0000-4000-8000-000000000004'$$,
  'an unused bottle presentation can still be corrected'
);

select * from finish();
rollback;
