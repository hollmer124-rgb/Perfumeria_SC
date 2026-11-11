-- Local transactional tests using the synthetic catalog in supabase/seed.sql.
-- All users, purchases, sales, inventory changes, triggers, and audit rows roll
-- back with this test transaction.
create extension if not exists pgtap with schema extensions;

begin;

select plan(53);

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
    '97000000-0000-4000-8000-000000000041',
    'authenticated',
    'authenticated',
    'commercial-test-employee@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '97000000-0000-4000-8000-000000000042',
    'authenticated',
    'authenticated',
    'commercial-test-admin@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '97000000-0000-4000-8000-000000000043',
    'authenticated',
    'authenticated',
    'commercial-test-no-profile@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  );

select private.begin_system_maintenance(
  'pgtap commercial transaction fixture setup'
);

insert into public.profiles (id, role, display_name)
values
  ('97000000-0000-4000-8000-000000000041', 'employee', 'Commercial test employee'),
  ('97000000-0000-4000-8000-000000000042', 'admin', 'Commercial test admin');

select private.end_system_maintenance();

create temporary table commercial_test_refs (
  ref text primary key,
  id uuid not null
);
grant select, insert, update on commercial_test_refs to authenticated;

create function private.pgtap_fail_inventory_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.pgtap_failure_mode', true) = 'purchase'
     and new.movement_type = 'purchase' then
    raise exception 'forced purchase movement failure' using errcode = 'P0001';
  end if;
  if current_setting('app.pgtap_failure_mode', true) = 'manufacture'
     and new.movement_type = 'sale'
     and new.material_id is not null then
    raise exception 'forced manufacture movement failure' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger pgtap_fail_inventory_movement
before insert on public.inventory_movements
for each row execute function private.pgtap_fail_inventory_movement();

create function private.pgtap_fail_cash_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.pgtap_failure_mode', true) = 'sale_payment'
     and new.movement_type = 'sale_in' then
    raise exception 'forced sale payment failure' using errcode = 'P0001';
  end if;
  if current_setting('app.pgtap_failure_mode', true) = 'reversal'
     and new.movement_type = 'withdrawal' then
    raise exception 'forced reversal payment failure' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger pgtap_fail_cash_movement
before insert on public.cash_movements
for each row execute function private.pgtap_fail_cash_movement();

select ok(
  not has_function_privilege(
    'anon',
    'public.register_pos_sale(jsonb,public.payment_method,uuid,bigint,uuid,uuid,text)',
    'EXECUTE'
  ),
  'anon cannot execute commercial sale or manufacturing'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.create_purchase(uuid,date,jsonb,text,uuid)',
    'EXECUTE'
  ),
  'anon cannot create purchases'
);

select ok(
  not has_function_privilege(
    'anon', 'public.receive_purchase(uuid)', 'EXECUTE'
  ),
  'anon cannot receive purchases'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000041',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000041","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.create_purchase(
      '91000000-0000-4000-8000-000000000002',
      current_date,
      '[{"type":"material","id":"94000000-0000-4000-8000-000000000001","quantity":1,"unit_cost_cop":1}]'::jsonb,
      null,
      '97000000-0000-4000-8000-000000000081'::uuid
    )$$,
  '42501',
  'Only an authenticated administrator can create purchases',
  'an employee cannot create a purchase'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000042',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000042","role":"authenticated"}',
  true
);
insert into pg_temp.commercial_test_refs (ref, id)
select
  'purchase',
  public.create_purchase(
    '91000000-0000-4000-8000-000000000002',
    current_date,
    jsonb_build_array(
      jsonb_build_object(
        'type', 'retail_product',
        'id', '93000000-0000-4000-8000-000000000001',
        'quantity', 4,
        'unit_cost_cop', 40000
      ),
      jsonb_build_object(
        'type', 'material',
        'id', '94000000-0000-4000-8000-000000000001',
        'quantity', 100,
        'unit_cost_cop', 2000
      ),
      jsonb_build_object(
        'type', 'material',
        'id', '94000000-0000-4000-8000-000000000009',
        'quantity', 100,
        'unit_cost_cop', 1000
      ),
      jsonb_build_object(
        'type', 'material',
        'id', '94000000-0000-4000-8000-000000000010',
        'quantity', 10,
        'unit_cost_cop', 1000
      ),
      jsonb_build_object(
        'type', 'material',
        'id', '94000000-0000-4000-8000-000000000011',
        'quantity', 10,
        'unit_cost_cop', 5000
      )
    ),
    'pgTAP local purchase and inventory receipt',
    '97000000-0000-4000-8000-000000000082'::uuid
  );
select public.receive_purchase(
  (select id from pg_temp.commercial_test_refs where ref = 'purchase')
);
select public.activate_recipe(
  '95000000-0000-4000-8000-000000000001'
);
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000041',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000041","role":"authenticated"}',
  true
);
insert into pg_temp.commercial_test_refs (ref, id)
select 'employee_cash',
       public.open_financial_cash_session(500000, 'pgTAP employee cash');
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000042',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000042","role":"authenticated"}',
  true
);
insert into pg_temp.commercial_test_refs (ref, id)
select 'admin_cash',
       public.open_financial_cash_session(500000, 'pgTAP administrator cash');
reset role;

select is(
  (select count(*) from public.purchase_items pi
    where pi.purchase_id = (
      select id from pg_temp.commercial_test_refs where ref = 'purchase'
    )),
  5::bigint,
  'purchase contains its five supplier-linked inventory lines'
);

select is(
  (select total_cop from public.purchases
    where id = (select id from pg_temp.commercial_test_refs where ref = 'purchase')),
  520000::bigint,
  'receipt records the generated line-cost total'
);

select ok(
  (select status = 'received'
          and received_at is not null
          and supplier_id = '91000000-0000-4000-8000-000000000002'
     from public.purchases
    where id = (select id from pg_temp.commercial_test_refs where ref = 'purchase')),
  'received purchase retains supplier and receipt state'
);

select ok(
  (select stock_qty = 4 and avg_unit_cost_cop = 40000
     from public.retail_products
    where id = '93000000-0000-4000-8000-000000000001')
    and (select on_hand_qty = 100 and avg_unit_cost_cop = 2000
           from public.materials
          where id = '94000000-0000-4000-8000-000000000001')
    and (select on_hand_qty = 10 and avg_unit_cost_cop = 1000
           from public.materials
          where id = '94000000-0000-4000-8000-000000000010')
    and (select on_hand_qty = 100 and avg_unit_cost_cop = 1000
           from public.materials
          where id = '94000000-0000-4000-8000-000000000009')
    and (select on_hand_qty = 10 and avg_unit_cost_cop = 5000
           from public.materials
          where id = '94000000-0000-4000-8000-000000000011'),
  'receipt updates product and material stock with their actual units and costs'
);

select is(
  (select count(*) from public.inventory_movements
    where movement_type = 'purchase'
      and purchase_item_id in (
        select id from public.purchase_items
         where purchase_id = (
           select id from pg_temp.commercial_test_refs where ref = 'purchase'
         )
      )),
  5::bigint,
  'each received purchase line has a linked inventory movement'
);

select ok(
  exists (
    select 1 from public.audit_logs
     where table_name = 'purchases'
       and record_id = (
         select id::text from pg_temp.commercial_test_refs where ref = 'purchase'
       )
       and action = 'UPDATE'
       and actor_id = '97000000-0000-4000-8000-000000000042'
  )
  and exists (
    select 1 from public.audit_logs
     where table_name = 'inventory_movements'
       and actor_id = '97000000-0000-4000-8000-000000000042'
  ),
  'purchase receipt and its inventory movements are audited'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000042',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000042","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.create_purchase(
      '91000000-0000-4000-8000-000000000002',
      current_date,
      '[{"type":"material","id":"94000000-0000-4000-8000-000000000001","quantity":1,"unit_cost_cop":1},{"type":"retail_product","id":"93999999-0000-4000-8000-000000000001","quantity":1,"unit_cost_cop":1}]'::jsonb,
      null,
      '97000000-0000-4000-8000-000000000083'::uuid
    )$$,
  '23503',
  'An active finished product in the purchase was not found',
  'a purchase with a missing later line is rejected'
);
reset role;

select is(
  (select count(*) from public.purchases
    where created_by = '97000000-0000-4000-8000-000000000042'),
  1::bigint,
  'failed purchase creation leaves no partial purchase header'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000042',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000042","role":"authenticated"}',
  true
);
insert into pg_temp.commercial_test_refs (ref, id)
select
  'failing_purchase',
  public.create_purchase(
    '91000000-0000-4000-8000-000000000002',
    current_date,
    '[{"type":"material","id":"94000000-0000-4000-8000-000000000001","quantity":1,"unit_cost_cop":1}]'::jsonb,
    'pgTAP forced receipt rollback',
    '97000000-0000-4000-8000-000000000084'::uuid
  );
select set_config('app.pgtap_failure_mode', 'purchase', true);
select throws_ok(
  $$select public.receive_purchase(
      (select id from pg_temp.commercial_test_refs where ref = 'failing_purchase')
    )$$,
  'P0001',
  'forced purchase movement failure',
  'a failure after stock update aborts purchase receipt'
);
select set_config('app.pgtap_failure_mode', '', true);
reset role;

select is(
  (select status::text from public.purchases
    where id = (select id from pg_temp.commercial_test_refs where ref = 'failing_purchase')),
  'draft',
  'failed receipt leaves the purchase draft'
);

select is(
  (select on_hand_qty from public.materials
    where id = '94000000-0000-4000-8000-000000000001'),
  100::numeric,
  'failed receipt rolls back the stock update'
);

select is(
  (select count(*) from public.inventory_movements
    where purchase_item_id in (
      select id from public.purchase_items
       where purchase_id = (
         select id from pg_temp.commercial_test_refs where ref = 'failing_purchase'
       )
    )),
  0::bigint,
  'failed receipt leaves no inventory movement'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000042',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000042","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.receive_purchase(
      (select id from pg_temp.commercial_test_refs where ref = 'purchase')
    )$$,
  '55000',
  'Only draft purchases can be received',
  'a received purchase cannot be received twice'
);
reset role;

select is(
  (select on_hand_qty from public.materials
    where id = '94000000-0000-4000-8000-000000000001'),
  100::numeric,
  'a repeated receipt does not change stock'
);

select is(
  (select status::text from public.recipes
    where id = '95000000-0000-4000-8000-000000000001'),
  'active',
  'administrator activates the seeded recipe using the existing activation RPC'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000043',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000043","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.register_pos_sale(
      '[]'::jsonb,
      'transfer'::public.payment_method,
      '97000000-0000-4000-8000-000000000051'::uuid
    )$$,
  '42501',
  'An authenticated employee or administrator is required',
  'an authenticated account without an employee or admin profile cannot sell'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000041',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000041","role":"authenticated"}',
  true
);
insert into pg_temp.commercial_test_refs (ref, id)
select 'employee_sale',
       public.register_pos_sale(
         '[{"kind":"retail_product","id":"93000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
         'cash',
         '97000000-0000-4000-8000-000000000052',
         0,
         null,
         (select id from pg_temp.commercial_test_refs where ref = 'employee_cash'),
         'pgTAP employee retail sale'
       );
reset role;

select ok(
  (select payment_method = 'cash'
          and subtotal_cop = 120000
          and discount_cop = 0
          and total_cop = 120000
     from public.sales
    where id = (select id from pg_temp.commercial_test_refs where ref = 'employee_sale')),
  'employee sale records the admitted payment method and coherent totals'
);

select is(
  (select count(*) from public.sale_items
    where sale_id = (select id from pg_temp.commercial_test_refs where ref = 'employee_sale')
      and retail_product_id = '93000000-0000-4000-8000-000000000001'
      and quantity = 1
      and line_total_cop = 120000),
  1::bigint,
  'sale detail references the sold product and quantity'
);

select is(
  (select count(*) from public.cash_movements
    where sale_id = (select id from pg_temp.commercial_test_refs where ref = 'employee_sale')
      and movement_type = 'sale_in'
      and signed_amount_cop = 120000),
  1::bigint,
  'cash sale writes its payment ledger movement'
);

select is(
  (select stock_qty from public.retail_products
    where id = '93000000-0000-4000-8000-000000000001'),
  3::numeric,
  'employee sale decreases product stock by one'
);

select ok(
  exists (
    select 1 from public.inventory_movements
     where sale_item_id = (
       select id from public.sale_items
        where sale_id = (select id from pg_temp.commercial_test_refs where ref = 'employee_sale')
     )
       and retail_product_id = '93000000-0000-4000-8000-000000000001'
       and movement_type = 'sale'
       and quantity_delta = -1
  )
  and exists (
    select 1 from public.audit_logs
     where table_name = 'sales'
       and record_id = (
         select id::text from pg_temp.commercial_test_refs where ref = 'employee_sale'
       )
       and action = 'INSERT'
       and actor_id = '97000000-0000-4000-8000-000000000041'
  ),
  'sale inventory movement is linked and the sale is audited'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000041',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000041","role":"authenticated"}',
  true
);
insert into pg_temp.commercial_test_refs (ref, id)
select 'sale_retry',
       public.register_pos_sale(
         '[{"kind":"retail_product","id":"93000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
         'cash',
         '97000000-0000-4000-8000-000000000052',
         0,
         null,
         (select id from pg_temp.commercial_test_refs where ref = 'employee_cash'),
         'pgTAP employee retail sale'
       );
select throws_ok(
  $$select public.register_pos_sale(
      '[{"kind":"retail_product","id":"93000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      'cash',
      '97000000-0000-4000-8000-000000000052',
      0,
      null,
      (select id from pg_temp.commercial_test_refs where ref = 'employee_cash'),
      'different request payload'
    )$$,
  '23505',
  'Idempotency key was already used for a different request',
  'reusing a sale key with a changed request is rejected'
);
reset role;

select is(
  (select id from pg_temp.commercial_test_refs where ref = 'sale_retry'),
  (select id from pg_temp.commercial_test_refs where ref = 'employee_sale'),
  'identical sale retries return the original sale'
);

select ok(
  (select stock_qty = 3 from public.retail_products
    where id = '93000000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.inventory_movements
        where sale_item_id in (
          select id from public.sale_items
           where sale_id = (select id from pg_temp.commercial_test_refs where ref = 'employee_sale')
        )),
  'an identical retry does not duplicate stock consumption or movements'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000041',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000041","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.register_pos_sale(
      '[{"kind":"retail_product","id":"93999999-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      'transfer',
      '97000000-0000-4000-8000-000000000053'::uuid
    )$$,
  'P0002',
  'An active retail product was not found',
  'a sale cannot reference a missing product'
);

select throws_ok(
  $$select public.register_pos_sale(
      '[{"kind":"retail_product","id":"93000000-0000-4000-8000-000000000001","quantity":0}]'::jsonb,
      'transfer',
      '97000000-0000-4000-8000-000000000054'::uuid
    )$$,
  '22023',
  'Sale line has an invalid shape, id, quantity, or fill measurement',
  'a sale rejects a non-positive quantity'
);

select throws_ok(
  $$select public.register_pos_sale(
      '[{"kind":"retail_product","id":"93000000-0000-4000-8000-000000000001","quantity":999}]'::jsonb,
      'transfer',
      '97000000-0000-4000-8000-000000000055'::uuid
    )$$,
  '23514',
  'Insufficient stock for retail product ' || (
    select name from public.retail_products
     where id = '93000000-0000-4000-8000-000000000001'
  ),
  'a sale rejects stock quantities above available inventory'
);

select set_config('app.pgtap_failure_mode', 'sale_payment', true);
select throws_ok(
  $$select public.register_pos_sale(
      '[{"kind":"retail_product","id":"93000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      'cash',
      '97000000-0000-4000-8000-000000000056'::uuid,
      0,
      null,
      (select id from pg_temp.commercial_test_refs where ref = 'employee_cash'),
      'pgTAP forced sale rollback'
    )$$,
  'P0001',
  'forced sale payment failure',
  'a payment failure after sale and inventory writes rolls back the transaction'
);
select set_config('app.pgtap_failure_mode', '', true);
reset role;

select ok(
  not exists (
    select 1 from public.sales
     where idempotency_key = '97000000-0000-4000-8000-000000000056'
  )
  and (select stock_qty = 3 from public.retail_products
        where id = '93000000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.inventory_movements
        where retail_product_id = '93000000-0000-4000-8000-000000000001'
          and movement_type = 'sale'),
  'failed sale leaves no document, stock change, or inventory movement'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000041',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000041","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.register_pos_sale(
      '[{"kind":"recipe","id":"95000000-0000-4000-8000-000000000001","quantity":7,"fill_consumption_ml":12.5}]'::jsonb,
      'transfer',
      '97000000-0000-4000-8000-000000000057'::uuid
    )$$,
  '23514',
  'Insufficient material inventory for recipe 95000000-0000-4000-8000-000000000001',
  'manufacture validates each material against its own recipe quantity and unit'
);
reset role;

select is(
  (select on_hand_qty from public.materials
    where id = '94000000-0000-4000-8000-000000000001'),
  100::numeric,
  'insufficient material prevents any manufacturing stock change'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000041',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000041","role":"authenticated"}',
  true
);
select set_config('app.pgtap_failure_mode', 'manufacture', true);
select throws_ok(
  $$select public.register_pos_sale(
      '[{"kind":"recipe","id":"95000000-0000-4000-8000-000000000001","quantity":1,"fill_consumption_ml":12.5}]'::jsonb,
      'transfer',
      '97000000-0000-4000-8000-000000000058'::uuid
    )$$,
  'P0001',
  'forced manufacture movement failure',
  'a movement failure after recipe consumption begins rolls back manufacture'
);
select set_config('app.pgtap_failure_mode', '', true);
reset role;

select ok(
  not exists (
    select 1 from public.sales
     where idempotency_key = '97000000-0000-4000-8000-000000000058'
  )
  and (select on_hand_qty = 100 from public.materials
        where id = '94000000-0000-4000-8000-000000000001')
  and (select count(*) = 0 from public.sale_material_usage smu
        join public.sale_items si on si.id = smu.sale_item_id
       where si.sale_id in (
         select id from public.sales
          where idempotency_key = '97000000-0000-4000-8000-000000000058'
       )),
  'failed manufacture leaves no sale, material consumption, or usage record'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000041',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000041","role":"authenticated"}',
  true
);
insert into pg_temp.commercial_test_refs (ref, id)
select 'employee_manufacture',
       public.register_pos_sale(
         '[{"kind":"recipe","id":"95000000-0000-4000-8000-000000000001","quantity":2,"fill_consumption_ml":12.5}]'::jsonb,
         'transfer',
         '97000000-0000-4000-8000-000000000059'::uuid
       );
reset role;

select ok(
  (select created_by = '97000000-0000-4000-8000-000000000041'
          and payment_method = 'transfer'
          and total_cop = 0
     from public.sales
    where id = (select id from pg_temp.commercial_test_refs where ref = 'employee_manufacture'))
  and (select count(*) = 1
         from public.sale_items
        where sale_id = (select id from pg_temp.commercial_test_refs where ref = 'employee_manufacture')
          and item_type = 'recipe'
          and recipe_id = '95000000-0000-4000-8000-000000000001'
          and quantity = 2
          and (recipe_snapshot ->> 'fill_consumption_ml_per_bottle')::numeric = 12.5),
  'employee manufacture creates a sale detail linked to the active recipe and measured fill'
);

select ok(
  (select count(*) = 4
     from public.sale_material_usage smu
     join public.sale_items si on si.id = smu.sale_item_id
    where si.sale_id = (
      select id from pg_temp.commercial_test_refs where ref = 'employee_manufacture'
    ))
  and exists (
    select 1 from public.sale_material_usage smu
      join public.sale_items si on si.id = smu.sale_item_id
     where si.sale_id = (
       select id from pg_temp.commercial_test_refs where ref = 'employee_manufacture'
     )
       and smu.material_id = '94000000-0000-4000-8000-000000000001'
       and smu.unit_snapshot = 'g' and smu.quantity_used = 30
  )
  and exists (
    select 1 from public.sale_material_usage smu
      join public.sale_items si on si.id = smu.sale_item_id
     where si.sale_id = (
       select id from pg_temp.commercial_test_refs where ref = 'employee_manufacture'
     )
       and smu.material_id = '94000000-0000-4000-8000-000000000010'
       and smu.unit_snapshot = 'dose' and smu.quantity_used = 2
  )
  and exists (
    select 1 from public.sale_material_usage smu
      join public.sale_items si on si.id = smu.sale_item_id
     where si.sale_id = (
       select id from pg_temp.commercial_test_refs where ref = 'employee_manufacture'
     )
       and smu.material_id = '94000000-0000-4000-8000-000000000009'
       and smu.unit_snapshot = 'ml' and smu.quantity_used = 25
  )
  and exists (
    select 1 from public.sale_material_usage smu
      join public.sale_items si on si.id = smu.sale_item_id
     where si.sale_id = (
       select id from pg_temp.commercial_test_refs where ref = 'employee_manufacture'
     )
       and smu.material_id = '94000000-0000-4000-8000-000000000011'
       and smu.unit_snapshot = 'unit' and smu.quantity_used = 2
  ),
  'manufacture consumes the seeded formula quantities without converting unlike units'
);

select is(
  (select count(*) from public.inventory_movements im
    join public.sale_items si on si.id = im.sale_item_id
   where si.sale_id = (
     select id from pg_temp.commercial_test_refs where ref = 'employee_manufacture'
   )
     and im.movement_type = 'sale'
     and im.quantity_delta < 0),
  4::bigint,
  'manufacturing records one linked inventory movement per recipe material'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000042',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000042","role":"authenticated"}',
  true
);
insert into pg_temp.commercial_test_refs (ref, id)
select 'admin_manufacture',
       public.register_pos_sale(
         '[{"kind":"recipe","id":"95000000-0000-4000-8000-000000000001","quantity":1,"fill_consumption_ml":12.5}]'::jsonb,
         'transfer',
         '97000000-0000-4000-8000-000000000060'::uuid
       );
reset role;

select ok(
  (select created_by = '97000000-0000-4000-8000-000000000042'
     from public.sales
    where id = (select id from pg_temp.commercial_test_refs where ref = 'admin_manufacture'))
  and (select count(*) = 4
         from public.sale_material_usage smu
         join public.sale_items si on si.id = smu.sale_item_id
        where si.sale_id = (
          select id from pg_temp.commercial_test_refs where ref = 'admin_manufacture'
        )),
  'administrator can also record a linked recipe manufacture'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000041',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000041","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.admin_reverse_sale(
      (select id from pg_temp.commercial_test_refs where ref = 'employee_sale'),
      'refund',
      'Unauthorized reversal test',
      true,
      'transfer',
      null
    )$$,
  '42501',
  'Only an authenticated administrator can reverse a sale',
  'an employee cannot reverse a sale'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000042',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000042","role":"authenticated"}',
  true
);
insert into pg_temp.commercial_test_refs (ref, id)
select 'admin_sale',
       public.register_pos_sale(
         '[{"kind":"retail_product","id":"93000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
         'cash',
         '97000000-0000-4000-8000-000000000061'::uuid,
         5000,
         null,
         (select id from pg_temp.commercial_test_refs where ref = 'admin_cash'),
         'pgTAP administrator discounted sale'
       );
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000041',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000041","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.register_pos_sale(
      '[{"kind":"retail_product","id":"93000000-0000-4000-8000-000000000001","quantity":1}]'::jsonb,
      'transfer',
      '97000000-0000-4000-8000-000000000062'::uuid,
      5000
    )$$,
  '42501',
  'Only an administrator can apply a sale discount',
  'the sale RPC does not allow an employee to apply an administrator discount'
);
reset role;

select is(
  (select subtotal_cop - discount_cop from public.sales
    where id = (select id from pg_temp.commercial_test_refs where ref = 'admin_sale')),
  115000::bigint,
  'administrator discount is reflected in the sale total'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000042',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000042","role":"authenticated"}',
  true
);
select set_config('app.pgtap_failure_mode', 'reversal', true);
select throws_ok(
  $$select public.admin_reverse_sale(
      (select id from pg_temp.commercial_test_refs where ref = 'admin_sale'),
      'refund',
      'pgTAP forced reversal rollback',
      true,
      'cash',
      (select id from pg_temp.commercial_test_refs where ref = 'admin_cash')
    )$$,
  'P0001',
  'forced reversal payment failure',
  'a refund payment failure rolls back the adjustment and restored stock'
);
select set_config('app.pgtap_failure_mode', '', true);
reset role;

select ok(
  (select status = 'completed' from public.sales
    where id = (select id from pg_temp.commercial_test_refs where ref = 'admin_sale'))
  and not exists (
    select 1 from public.sale_adjustments
     where sale_id = (select id from pg_temp.commercial_test_refs where ref = 'admin_sale')
  )
  and (select stock_qty = 2 from public.retail_products
        where id = '93000000-0000-4000-8000-000000000001'),
  'failed refund leaves the sale completed and does not restore stock'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000042',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000042","role":"authenticated"}',
  true
);
insert into pg_temp.commercial_test_refs (ref, id)
select 'admin_adjustment',
       public.admin_reverse_sale(
         (select id from pg_temp.commercial_test_refs where ref = 'admin_sale'),
         'refund',
         'pgTAP local refund',
         true,
         'cash',
         (select id from pg_temp.commercial_test_refs where ref = 'admin_cash')
       );
reset role;

select ok(
  (select status = 'voided' from public.sales
    where id = (select id from pg_temp.commercial_test_refs where ref = 'admin_sale'))
  and (select inventory_restored
         from public.sale_adjustments
        where id = (select id from pg_temp.commercial_test_refs where ref = 'admin_adjustment'))
  and (select stock_qty = 3 from public.retail_products
        where id = '93000000-0000-4000-8000-000000000001'),
  'administrator refund voids the sale and restores its inventory exactly once'
);

select is(
  (select count(*) from public.cash_movements
    where sale_adjustment_id = (
      select id from pg_temp.commercial_test_refs where ref = 'admin_adjustment'
    )
      and movement_type = 'withdrawal'
      and signed_amount_cop = -115000),
  1::bigint,
  'cash refund records a linked withdrawal for the discounted sale total'
);

select is(
  (select expected_cop from public.cash_sessions
    where id = (select id from pg_temp.commercial_test_refs where ref = 'admin_cash')),
  500000::bigint,
  'cash session balance reconciles opening, sale payment, and refund'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '97000000-0000-4000-8000-000000000042',
  true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"97000000-0000-4000-8000-000000000042","role":"authenticated"}',
  true
);
select throws_ok(
  $$select public.admin_reverse_sale(
      (select id from pg_temp.commercial_test_refs where ref = 'admin_sale'),
      'refund',
      'duplicate refund attempt',
      true,
      'cash',
      (select id from pg_temp.commercial_test_refs where ref = 'admin_cash')
    )$$,
  '55000',
  'Only a completed sale can be reversed',
  'a completed refund cannot be applied a second time'
);
reset role;

select is(
  (select count(*) from public.sale_adjustments
    where sale_id = (select id from pg_temp.commercial_test_refs where ref = 'admin_sale')),
  1::bigint,
  'a sale has at most one reversal record'
);

select ok(
  (select abs(stock_qty - coalesce((
            select sum(quantity_delta)
              from public.inventory_movements
             where retail_product_id = '93000000-0000-4000-8000-000000000001'
          ), 0)) < 0.0001
     from public.retail_products
    where id = '93000000-0000-4000-8000-000000000001')
  and (select abs(on_hand_qty - coalesce((
            select sum(quantity_delta)
              from public.inventory_movements
             where material_id = '94000000-0000-4000-8000-000000000001'
          ), 0)) < 0.0001
        from public.materials
       where id = '94000000-0000-4000-8000-000000000001')
  and (select abs(on_hand_qty - coalesce((
            select sum(quantity_delta)
              from public.inventory_movements
             where material_id = '94000000-0000-4000-8000-000000000009'
          ), 0)) < 0.0001
        from public.materials
       where id = '94000000-0000-4000-8000-000000000009')
  and (select abs(on_hand_qty - coalesce((
            select sum(quantity_delta)
              from public.inventory_movements
             where material_id = '94000000-0000-4000-8000-000000000010'
          ), 0)) < 0.0001
        from public.materials
       where id = '94000000-0000-4000-8000-000000000010')
  and (select abs(on_hand_qty - coalesce((
            select sum(quantity_delta)
              from public.inventory_movements
             where material_id = '94000000-0000-4000-8000-000000000011'
          ), 0)) < 0.0001
        from public.materials
       where id = '94000000-0000-4000-8000-000000000011'),
  'on-hand quantities reconcile exactly with purchase, sale, and reversal movements'
);

select ok(
  exists (
    select 1 from public.audit_logs
     where table_name = 'sale_adjustments'
       and record_id = (
         select id::text from pg_temp.commercial_test_refs where ref = 'admin_adjustment'
       )
       and actor_id = '97000000-0000-4000-8000-000000000042'
  )
  and exists (
    select 1 from public.audit_logs
     where table_name = 'sales'
       and record_id = (
         select id::text from pg_temp.commercial_test_refs where ref = 'admin_sale'
       )
       and action = 'UPDATE'
       and actor_id = '97000000-0000-4000-8000-000000000042'
  ),
  'sale reversal and status change preserve administrator audit history'
);

select * from finish();
rollback;
