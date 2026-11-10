-- Migration 20261109210000: Perfumeria SC initial relational model.
-- All currency amounts are integer COP; all stock/formula quantities are NUMERIC.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.app_role as enum ('admin', 'employee');
create type public.material_unit as enum ('g', 'ml', 'unit', 'dose');
create type public.component_mode as enum ('fixed', 'fill_to_volume');
create type public.recipe_status as enum ('draft', 'active', 'archived');
create type public.retail_product_type as enum ('original', '1.1');
create type public.payment_method as enum ('cash', 'transfer', 'card', 'other');
create type public.sale_status as enum ('completed', 'voided');
create type public.purchase_status as enum ('draft', 'received', 'cancelled');
create type public.inventory_movement_type as enum (
  'purchase',
  'sale',
  'adjustment_in',
  'adjustment_out',
  'reversal'
);
create type public.cash_session_status as enum ('open', 'closed');
create type public.cash_movement_type as enum (
  'opening',
  'sale_in',
  'expense_out',
  'deposit',
  'withdrawal',
  'closing_adjustment'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'employee',
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.perfumes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  brand text not null check (length(btrim(brand)) between 1 and 120),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand, name)
);

create table public.retail_products (
  id uuid primary key default gen_random_uuid(),
  perfume_id uuid references public.perfumes (id) on delete restrict,
  product_type public.retail_product_type not null,
  sku text not null unique check (length(btrim(sku)) between 1 and 80),
  name text not null check (length(btrim(name)) between 1 and 180),
  size_ml integer check (size_ml is null or size_ml > 0),
  price_cop bigint not null check (price_cop >= 0),
  stock_qty numeric(14, 3) not null default 0 check (stock_qty >= 0),
  avg_unit_cost_cop bigint not null default 0 check (avg_unit_cost_cop >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (stock_qty = trunc(stock_qty)),
  check (stock_qty::text not in ('NaN', 'Infinity', '-Infinity'))
);

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 180),
  base_unit public.material_unit not null,
  on_hand_qty numeric(14, 4) not null default 0
    check (on_hand_qty >= 0 and on_hand_qty::text not in ('NaN', 'Infinity', '-Infinity')),
  avg_unit_cost_cop bigint not null default 0 check (avg_unit_cost_cop >= 0),
  minimum_qty numeric(14, 4) not null default 0
    check (minimum_qty >= 0 and minimum_qty::text not in ('NaN', 'Infinity', '-Infinity')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  perfume_id uuid not null references public.perfumes (id) on delete restrict,
  size_ml integer not null check (size_ml in (30, 50, 60, 100)),
  version integer not null check (version > 0),
  status public.recipe_status not null default 'draft',
  price_cop bigint not null check (price_cop >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (perfume_id, size_ml, version)
);

create unique index recipes_one_active_version_idx
  on public.recipes (perfume_id, size_ml)
  where status = 'active';
create index recipes_perfume_size_status_idx
  on public.recipes (perfume_id, size_ml, status);

create table public.recipe_components (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete restrict,
  mode public.component_mode not null default 'fixed',
  quantity numeric(14, 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (mode = 'fixed' and quantity is not null and quantity > 0
      and quantity::text not in ('NaN', 'Infinity', '-Infinity'))
    or (mode = 'fill_to_volume' and quantity is null)
  ),
  unique (recipe_id, material_id)
);
create unique index recipe_components_one_fill_idx
  on public.recipe_components (recipe_id)
  where mode = 'fill_to_volume';
create index recipe_components_material_idx
  on public.recipe_components (material_id);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(btrim(full_name)) between 1 and 160),
  phone text,
  email text,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_name_idx on public.customers (full_name);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 180),
  tax_id text,
  contact_name text,
  phone text,
  email text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  opened_by uuid not null references public.profiles (id) on delete restrict,
  status public.cash_session_status not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_cop bigint not null check (opening_cop >= 0),
  expected_cop bigint not null check (expected_cop >= 0),
  counted_cop bigint check (counted_cop is null or counted_cop >= 0),
  difference_cop bigint,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'open' and closed_at is null and counted_cop is null and difference_cop is null)
    or (status = 'closed' and closed_at is not null and counted_cop is not null
      and difference_cop = counted_cop - expected_cop)
  )
);
create unique index cash_sessions_one_open_per_user_idx
  on public.cash_sessions (opened_by)
  where status = 'open';
create index cash_sessions_opened_at_idx on public.cash_sessions (opened_at desc);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_number bigint generated always as identity unique,
  created_by uuid not null references public.profiles (id) on delete restrict,
  customer_id uuid references public.customers (id) on delete set null,
  cash_session_id uuid references public.cash_sessions (id) on delete restrict,
  status public.sale_status not null default 'completed',
  payment_method public.payment_method not null,
  subtotal_cop bigint not null default 0 check (subtotal_cop >= 0),
  total_cop bigint not null default 0 check (total_cop >= 0),
  total_cost_cop bigint not null default 0 check (total_cost_cop >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (subtotal_cop = total_cop)
);
create index sales_created_by_created_at_idx
  on public.sales (created_by, created_at desc);
create index sales_customer_created_at_idx
  on public.sales (customer_id, created_at desc);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id) on delete restrict,
  item_type text not null check (item_type in ('retail_product', 'recipe')),
  retail_product_id uuid references public.retail_products (id) on delete restrict,
  recipe_id uuid references public.recipes (id) on delete restrict,
  item_name_snapshot text not null check (length(btrim(item_name_snapshot)) > 0),
  product_type_snapshot public.retail_product_type,
  size_ml_snapshot integer check (size_ml_snapshot is null or size_ml_snapshot > 0),
  recipe_version_snapshot integer check (
    recipe_version_snapshot is null or recipe_version_snapshot > 0
  ),
  quantity numeric(14, 3) not null
    check (quantity > 0 and quantity::text not in ('NaN', 'Infinity', '-Infinity')),
  unit_price_cop bigint not null check (unit_price_cop >= 0),
  line_total_cop bigint not null check (line_total_cop >= 0),
  unit_cost_cop bigint not null check (unit_cost_cop >= 0),
  line_cost_cop bigint not null check (line_cost_cop >= 0),
  recipe_snapshot jsonb,
  created_at timestamptz not null default now(),
  check (
    (item_type = 'retail_product' and retail_product_id is not null
      and recipe_id is null and recipe_snapshot is null
      and product_type_snapshot is not null
      and size_ml_snapshot is null and recipe_version_snapshot is null
      and quantity = trunc(quantity))
    or
    (item_type = 'recipe' and recipe_id is not null
      and retail_product_id is null and recipe_snapshot is not null
      and product_type_snapshot is null
      and size_ml_snapshot is not null and recipe_version_snapshot is not null
      and quantity = trunc(quantity))
  ),
  check (line_total_cop = round(quantity * unit_price_cop)::bigint)
);
create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_retail_product_idx on public.sale_items (retail_product_id)
  where retail_product_id is not null;
create index sale_items_recipe_idx on public.sale_items (recipe_id)
  where recipe_id is not null;

create table public.sale_material_usage (
  id uuid primary key default gen_random_uuid(),
  sale_item_id uuid not null references public.sale_items (id) on delete restrict,
  material_id uuid not null references public.materials (id) on delete restrict,
  material_name_snapshot text not null,
  unit_snapshot public.material_unit not null,
  quantity_used numeric(14, 4) not null
    check (quantity_used > 0
      and quantity_used::text not in ('NaN', 'Infinity', '-Infinity')),
  unit_cost_cop bigint not null check (unit_cost_cop >= 0),
  total_cost_cop bigint not null check (total_cost_cop >= 0),
  created_at timestamptz not null default now(),
  unique (sale_item_id, material_id)
);
create index sale_material_usage_material_idx
  on public.sale_material_usage (material_id);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  created_by uuid not null references public.profiles (id) on delete restrict,
  status public.purchase_status not null default 'draft',
  purchased_at timestamptz not null default now(),
  received_at timestamptz,
  total_cop bigint not null default 0 check (total_cop >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'received' and received_at is not null)
    or (status <> 'received' and received_at is null)
  )
);
create index purchases_supplier_date_idx
  on public.purchases (supplier_id, purchased_at desc);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases (id) on delete restrict,
  material_id uuid references public.materials (id) on delete restrict,
  retail_product_id uuid references public.retail_products (id) on delete restrict,
  quantity numeric(14, 4) not null
    check (quantity > 0 and quantity::text not in ('NaN', 'Infinity', '-Infinity')),
  unit_cost_cop bigint not null check (unit_cost_cop >= 0),
  line_total_cop bigint generated always as (
    round(quantity * unit_cost_cop)::bigint
  ) stored,
  created_at timestamptz not null default now(),
  check (
    (material_id is not null and retail_product_id is null)
    or (material_id is null and retail_product_id is not null
      and quantity = trunc(quantity))
  ),
  unique (purchase_id, material_id),
  unique (purchase_id, retail_product_id)
);
create index purchase_items_material_idx on public.purchase_items (material_id)
  where material_id is not null;
create index purchase_items_retail_product_idx
  on public.purchase_items (retail_product_id) where retail_product_id is not null;

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  material_id uuid references public.materials (id) on delete restrict,
  retail_product_id uuid references public.retail_products (id) on delete restrict,
  movement_type public.inventory_movement_type not null,
  sale_item_id uuid references public.sale_items (id) on delete restrict,
  purchase_item_id uuid references public.purchase_items (id) on delete restrict,
  quantity_delta numeric(14, 4) not null
    check (quantity_delta <> 0
      and quantity_delta::text not in ('NaN', 'Infinity', '-Infinity')),
  unit_cost_cop bigint not null check (unit_cost_cop >= 0),
  total_cost_cop bigint not null check (total_cost_cop >= 0),
  reason text,
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  check (
    (material_id is not null and retail_product_id is null)
    or (material_id is null and retail_product_id is not null
      and quantity_delta = trunc(quantity_delta))
  ),
  check (
    (movement_type = 'sale' and sale_item_id is not null and purchase_item_id is null
      and quantity_delta < 0)
    or (movement_type = 'purchase' and purchase_item_id is not null
      and sale_item_id is null and quantity_delta > 0)
    or (movement_type in ('adjustment_in', 'reversal') and quantity_delta > 0
      and sale_item_id is null and purchase_item_id is null)
    or (movement_type = 'adjustment_out' and quantity_delta < 0
      and sale_item_id is null and purchase_item_id is null)
  ),
  check (
    (movement_type in ('adjustment_in', 'adjustment_out')
      and reason is not null and length(btrim(reason)) between 1 and 240)
    or (movement_type not in ('adjustment_in', 'adjustment_out') and reason is null)
  )
);
create index inventory_movements_material_date_idx
  on public.inventory_movements (material_id, created_at desc)
  where material_id is not null;
create index inventory_movements_retail_date_idx
  on public.inventory_movements (retail_product_id, created_at desc)
  where retail_product_id is not null;
create unique index inventory_movements_sale_item_material_idx
  on public.inventory_movements (sale_item_id, material_id)
  where sale_item_id is not null and material_id is not null;
create unique index inventory_movements_sale_item_product_idx
  on public.inventory_movements (sale_item_id, retail_product_id)
  where sale_item_id is not null and retail_product_id is not null;
create unique index inventory_movements_purchase_item_material_idx
  on public.inventory_movements (purchase_item_id, material_id)
  where purchase_item_id is not null and material_id is not null;
create unique index inventory_movements_purchase_item_product_idx
  on public.inventory_movements (purchase_item_id, retail_product_id)
  where purchase_item_id is not null and retail_product_id is not null;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id) on delete restrict,
  description text not null check (length(btrim(description)) between 1 and 240),
  amount_cop bigint not null check (amount_cop > 0),
  expense_date date not null default current_date,
  payment_method public.payment_method not null,
  cash_session_id uuid references public.cash_sessions (id) on delete restrict,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_date_idx on public.expenses (expense_date desc);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references public.cash_sessions (id) on delete restrict,
  movement_type public.cash_movement_type not null,
  sale_id uuid references public.sales (id) on delete restrict,
  expense_id uuid references public.expenses (id) on delete restrict,
  amount_cop bigint not null check (amount_cop > 0),
  signed_amount_cop bigint generated always as (
    case
      when movement_type in ('opening', 'sale_in', 'deposit') then amount_cop
      else -amount_cop
    end
  ) stored,
  description text,
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  check (
    (movement_type = 'sale_in' and sale_id is not null and expense_id is null)
    or (movement_type = 'expense_out' and expense_id is not null and sale_id is null)
    or (movement_type in ('opening', 'deposit', 'withdrawal', 'closing_adjustment')
      and sale_id is null and expense_id is null)
  )
);
create index cash_movements_session_created_idx
  on public.cash_movements (cash_session_id, created_at);
create unique index cash_movements_one_sale_idx
  on public.cash_movements (sale_id) where sale_id is not null;
create unique index cash_movements_one_expense_idx
  on public.cash_movements (expense_id) where expense_id is not null;

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index audit_logs_actor_created_idx
  on public.audit_logs (actor_id, created_at desc);
