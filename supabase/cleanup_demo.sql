-- Remove only deterministic DEMO rows from supabase/seed.sql and the previous
-- TEST ONLY fixture. Run with the trusted local database owner, never remotely.
-- Any later business use or edit blocks cleanup so historical data is preserved.

begin;

select private.begin_system_maintenance(
  'Remove synthetic Perfumeria SC demo fixtures'
);

do $$
declare
  v_supplier_ids constant uuid[] := array[
    '91000000-0000-4000-8000-000000000001'::uuid,
    '91000000-0000-4000-8000-000000000002'::uuid,
    '91000000-0000-4000-8000-000000000003'::uuid,
    'c0000000-0000-4000-8000-000000000001'::uuid
  ];
  v_perfume_ids constant uuid[] := array[
    '92000000-0000-4000-8000-000000000001'::uuid,
    '92000000-0000-4000-8000-000000000002'::uuid,
    '92000000-0000-4000-8000-000000000003'::uuid,
    '92000000-0000-4000-8000-000000000004'::uuid,
    '92000000-0000-4000-8000-000000000005'::uuid,
    '92000000-0000-4000-8000-000000000006'::uuid,
    '92000000-0000-4000-8000-000000000007'::uuid,
    '92000000-0000-4000-8000-000000000008'::uuid,
    '92000000-0000-4000-8000-000000000009'::uuid,
    '92000000-0000-4000-8000-000000000010'::uuid,
    'f0000000-0000-4000-8000-000000000001'::uuid
  ];
  v_product_ids constant uuid[] := array[
    '93000000-0000-4000-8000-000000000001'::uuid,
    '93000000-0000-4000-8000-000000000002'::uuid,
    '93000000-0000-4000-8000-000000000003'::uuid,
    '93000000-0000-4000-8000-000000000004'::uuid,
    '93000000-0000-4000-8000-000000000005'::uuid,
    '93000000-0000-4000-8000-000000000006'::uuid,
    '93000000-0000-4000-8000-000000000007'::uuid,
    '93000000-0000-4000-8000-000000000008'::uuid,
    '93000000-0000-4000-8000-000000000009'::uuid,
    '93000000-0000-4000-8000-000000000010'::uuid,
    'b0000000-0000-4000-8000-000000000001'::uuid
  ];
  v_material_ids constant uuid[] := array[
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
    '94000000-0000-4000-8000-000000000014'::uuid,
    'a0000000-0000-4000-8000-000000000001'::uuid,
    'a0000000-0000-4000-8000-000000000002'::uuid
  ];
  v_recipe_ids constant uuid[] := array[
    '95000000-0000-4000-8000-000000000001'::uuid,
    'e0000000-0000-4000-8000-000000000001'::uuid
  ];
  v_component_ids constant uuid[] := array[
    '95100000-0000-4000-8000-000000000001'::uuid,
    '95100000-0000-4000-8000-000000000002'::uuid,
    '95100000-0000-4000-8000-000000000003'::uuid,
    '95100000-0000-4000-8000-000000000004'::uuid,
    'e1000000-0000-4000-8000-000000000001'::uuid,
    'e1000000-0000-4000-8000-000000000002'::uuid
  ];
  v_customer_ids constant uuid[] := array[
    '96000000-0000-4000-8000-000000000001'::uuid,
    '96000000-0000-4000-8000-000000000002'::uuid,
    '96000000-0000-4000-8000-000000000003'::uuid,
    '96000000-0000-4000-8000-000000000004'::uuid,
    '96000000-0000-4000-8000-000000000005'::uuid,
    '96000000-0000-4000-8000-000000000006'::uuid,
    '96000000-0000-4000-8000-000000000007'::uuid,
    '96000000-0000-4000-8000-000000000008'::uuid,
    'd0000000-0000-4000-8000-000000000001'::uuid
  ];
  v_all_record_ids constant text[] := array[
    '91000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000003',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000003',
    '92000000-0000-4000-8000-000000000004',
    '92000000-0000-4000-8000-000000000005',
    '92000000-0000-4000-8000-000000000006',
    '92000000-0000-4000-8000-000000000007',
    '92000000-0000-4000-8000-000000000008',
    '92000000-0000-4000-8000-000000000009',
    '92000000-0000-4000-8000-000000000010',
    '93000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000003',
    '93000000-0000-4000-8000-000000000004',
    '93000000-0000-4000-8000-000000000005',
    '93000000-0000-4000-8000-000000000006',
    '93000000-0000-4000-8000-000000000007',
    '93000000-0000-4000-8000-000000000008',
    '93000000-0000-4000-8000-000000000009',
    '93000000-0000-4000-8000-000000000010',
    '94000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000002',
    '94000000-0000-4000-8000-000000000003',
    '94000000-0000-4000-8000-000000000004',
    '94000000-0000-4000-8000-000000000005',
    '94000000-0000-4000-8000-000000000006',
    '94000000-0000-4000-8000-000000000007',
    '94000000-0000-4000-8000-000000000008',
    '94000000-0000-4000-8000-000000000009',
    '94000000-0000-4000-8000-000000000010',
    '94000000-0000-4000-8000-000000000011',
    '94000000-0000-4000-8000-000000000012',
    '94000000-0000-4000-8000-000000000013',
    '94000000-0000-4000-8000-000000000014',
    '95000000-0000-4000-8000-000000000001',
    '95100000-0000-4000-8000-000000000001',
    '95100000-0000-4000-8000-000000000002',
    '95100000-0000-4000-8000-000000000003',
    '95100000-0000-4000-8000-000000000004',
    '96000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000002',
    '96000000-0000-4000-8000-000000000003',
    '96000000-0000-4000-8000-000000000004',
    '96000000-0000-4000-8000-000000000005',
    '96000000-0000-4000-8000-000000000006',
    '96000000-0000-4000-8000-000000000007',
    '96000000-0000-4000-8000-000000000008',
    'c0000000-0000-4000-8000-000000000001',
    'f0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000002',
    'e0000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000002',
    'd0000000-0000-4000-8000-000000000001'
  ];
begin
  perform s.id
    from public.suppliers s
   where s.id = any (v_supplier_ids)
   order by s.id
   for update;
  perform p.id
    from public.perfumes p
   where p.id = any (v_perfume_ids)
   order by p.id
   for update;
  perform rp.id
    from public.retail_products rp
   where rp.id = any (v_product_ids)
   order by rp.id
   for update;
  perform m.id
    from public.materials m
   where m.id = any (v_material_ids)
   order by m.id
   for update;
  perform r.id
    from public.recipes r
   where r.id = any (v_recipe_ids)
   order by r.id
   for update;
  perform rc.id
    from public.recipe_components rc
   where rc.id = any (v_component_ids)
   order by rc.id
   for update;
  perform c.id
    from public.customers c
   where c.id = any (v_customer_ids)
   order by c.id
   for update;

  if exists (
    select 1 from public.suppliers
     where id = any (v_supplier_ids)
       and name not like 'DEMO - %'
       and name not like 'TEST ONLY - %'
  ) or exists (
    select 1 from public.perfumes
     where id = any (v_perfume_ids)
       and (
         (name not like 'DEMO - %' and name not like 'TEST ONLY - %')
         or (brand not like 'DEMO - %' and brand not like 'TEST ONLY - %')
       )
  ) or exists (
    select 1 from public.retail_products
     where id = any (v_product_ids)
       and name not like 'DEMO - %'
       and name not like 'TEST ONLY - %'
  ) or exists (
    select 1 from public.materials
     where id = any (v_material_ids)
       and name not like 'DEMO - %'
       and name not like 'TEST ONLY - %'
  ) or exists (
    select 1 from public.customers
     where id = any (v_customer_ids)
       and full_name not like 'DEMO - %'
       and full_name not like 'TEST ONLY - %'
  ) then
    raise exception 'Cleanup stopped: one of the fixed demo IDs no longer contains a marked demo row';
  end if;

  if exists (
    select 1
      from public.recipe_components rc
     where rc.recipe_id = any (v_recipe_ids)
       and rc.id <> all (v_component_ids)
  ) then
    raise exception 'Cleanup stopped: a demo recipe has components not created by the seed';
  end if;

  if exists (
    select 1
      from public.recipe_components rc
     where rc.id = any (v_component_ids)
       and not (
         (
           rc.id = '95100000-0000-4000-8000-000000000001'::uuid
           and rc.recipe_id = '95000000-0000-4000-8000-000000000001'::uuid
           and rc.material_id = '94000000-0000-4000-8000-000000000001'::uuid
           and rc.mode = 'fixed' and rc.quantity = 15
         )
         or (
           rc.id = '95100000-0000-4000-8000-000000000002'::uuid
           and rc.recipe_id = '95000000-0000-4000-8000-000000000001'::uuid
           and rc.material_id = '94000000-0000-4000-8000-000000000010'::uuid
           and rc.mode = 'fixed' and rc.quantity = 1
         )
         or (
           rc.id = '95100000-0000-4000-8000-000000000003'::uuid
           and rc.recipe_id = '95000000-0000-4000-8000-000000000001'::uuid
           and rc.material_id = '94000000-0000-4000-8000-000000000009'::uuid
           and rc.mode = 'fill_to_volume' and rc.quantity is null
         )
         or (
           rc.id = '95100000-0000-4000-8000-000000000004'::uuid
           and rc.recipe_id = '95000000-0000-4000-8000-000000000001'::uuid
           and rc.material_id = '94000000-0000-4000-8000-000000000011'::uuid
           and rc.mode = 'fixed' and rc.quantity = 1
         )
         or (
           rc.id = 'e1000000-0000-4000-8000-000000000001'::uuid
           and rc.recipe_id = 'e0000000-0000-4000-8000-000000000001'::uuid
           and rc.material_id = 'a0000000-0000-4000-8000-000000000001'::uuid
           and rc.mode = 'fixed' and rc.quantity = 1
         )
         or (
           rc.id = 'e1000000-0000-4000-8000-000000000002'::uuid
           and rc.recipe_id = 'e0000000-0000-4000-8000-000000000001'::uuid
           and rc.material_id = 'a0000000-0000-4000-8000-000000000002'::uuid
           and rc.mode = 'fill_to_volume' and rc.quantity is null
         )
       )
  ) then
    raise exception 'Cleanup stopped: a fixed component ID no longer matches a known demo formula';
  end if;

  if exists (
    select 1
      from public.audit_logs al
     where al.record_id = any (v_all_record_ids)
       and al.action in ('UPDATE', 'DELETE')
       and (
         (al.table_name = 'suppliers' and exists (
           select 1 from public.suppliers s where s.id::text = al.record_id
         ))
         or (al.table_name = 'perfumes' and exists (
           select 1 from public.perfumes p where p.id::text = al.record_id
         ))
         or (al.table_name = 'retail_products' and exists (
           select 1 from public.retail_products rp where rp.id::text = al.record_id
         ))
         or (al.table_name = 'materials' and exists (
           select 1 from public.materials m where m.id::text = al.record_id
         ))
         or (al.table_name = 'recipes' and exists (
           select 1 from public.recipes r where r.id::text = al.record_id
         ))
         or (al.table_name = 'recipe_components' and exists (
           select 1 from public.recipe_components rc where rc.id::text = al.record_id
         ))
         or (al.table_name = 'customers' and exists (
           select 1 from public.customers c where c.id::text = al.record_id
         ))
       )
       and not (
         al.table_name = 'recipes'
         and al.record_id = 'e0000000-0000-4000-8000-000000000001'
         and al.action = 'UPDATE'
         and al.old_data ->> 'status' = 'draft'
         and al.new_data ->> 'status' = 'active'
       )
       and not (
         al.table_name = 'retail_products'
         and al.record_id = 'b0000000-0000-4000-8000-000000000001'
         and al.action = 'UPDATE'
         and al.old_data ->> 'brand' = ''
         and al.new_data ->> 'brand' = 'TEST ONLY - Marca de demostracion'
       )
  ) then
    raise exception 'Cleanup stopped: demo rows have later edits or deletes in the audit history';
  end if;

  if exists (
    select 1 from public.inventory_movements im
     where im.material_id = any (v_material_ids)
        or im.retail_product_id = any (v_product_ids)
  ) or exists (
    select 1 from public.purchase_items pi
     where pi.material_id = any (v_material_ids)
        or pi.retail_product_id = any (v_product_ids)
  ) or exists (
    select 1 from public.purchases p
     where p.supplier_id = any (v_supplier_ids)
  ) or exists (
    select 1 from public.sale_material_usage smu
     where smu.material_id = any (v_material_ids)
  ) or exists (
    select 1 from public.sale_items si
     where si.retail_product_id = any (v_product_ids)
        or si.recipe_id = any (v_recipe_ids)
  ) or exists (
    select 1 from public.sales s
     where s.customer_id = any (v_customer_ids)
  ) then
    raise exception 'Cleanup stopped: demo rows are referenced by purchases, sales, or inventory history';
  end if;

  if exists (
    select 1 from public.retail_products rp
     where rp.perfume_id = any (v_perfume_ids)
       and rp.id <> all (v_product_ids)
  ) or exists (
    select 1 from public.materials m
     where m.perfume_id = any (v_perfume_ids)
       and m.id <> all (v_material_ids)
  ) or exists (
    select 1 from public.recipes r
     where r.perfume_id = any (v_perfume_ids)
       and r.id <> all (v_recipe_ids)
  ) or exists (
    select 1 from public.recipe_components rc
     where rc.material_id = any (v_material_ids)
       and rc.recipe_id <> all (v_recipe_ids)
  ) or exists (
    select 1 from public.materials m
     where m.supplier_id = any (v_supplier_ids)
       and m.id <> all (v_material_ids)
  ) or exists (
    select 1 from public.retail_products rp
     where rp.supplier_id = any (v_supplier_ids)
       and rp.id <> all (v_product_ids)
  ) then
    raise exception 'Cleanup stopped: a demo supplier or perfume is referenced by non-demo catalog data';
  end if;

  if exists (
    select 1 from public.materials m
     where m.id = any (v_material_ids)
       and (m.on_hand_qty <> 0 or m.avg_unit_cost_cop <> 0)
  ) or exists (
    select 1 from public.retail_products rp
     where rp.id = any (v_product_ids)
       and (rp.stock_qty <> 0 or rp.avg_unit_cost_cop <> 0)
  ) then
    raise exception 'Cleanup stopped: a demo inventory item has stock or cost; preserve its history';
  end if;

  update public.recipes
     set status = 'archived'
   where id = any (v_recipe_ids)
     and status = 'active';

  update public.recipes
     set status = 'draft'
   where id = any (v_recipe_ids)
     and status = 'archived';

  delete from public.recipe_components
   where id = any (v_component_ids);

  delete from public.recipes
   where id = any (v_recipe_ids);

  delete from public.retail_products
   where id = any (v_product_ids);

  delete from public.materials
   where id = any (v_material_ids);

  delete from public.perfumes
   where id = any (v_perfume_ids);

  delete from public.customers
   where id = any (v_customer_ids);

  delete from public.suppliers
   where id = any (v_supplier_ids);

  delete from public.audit_logs
   where record_id = any (v_all_record_ids)
     and (
       (action = 'INSERT' and old_data is null)
       or (
         table_name = 'recipes'
         and record_id = 'e0000000-0000-4000-8000-000000000001'
         and action = 'UPDATE'
         and old_data ->> 'status' = 'draft'
         and new_data ->> 'status' = 'active'
       )
       or (
         table_name = 'retail_products'
         and record_id = 'b0000000-0000-4000-8000-000000000001'
         and action = 'UPDATE'
         and old_data ->> 'brand' = ''
         and new_data ->> 'brand' = 'TEST ONLY - Marca de demostracion'
       )
     );
end;
$$;

select private.end_system_maintenance();

commit;
