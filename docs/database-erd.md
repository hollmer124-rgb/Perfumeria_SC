# Modelo entidad-relación — Perfumeria SC

Este documento describe el modelo relacional inicial de Supabase PostgreSQL.
Las cantidades son `NUMERIC`; los importes expresados en COP son enteros. Las
recetas guardan cantidades en la unidad base de cada material y nunca convierten
entre gramos y mililitros.

```mermaid
erDiagram
    auth_users ||--|| profiles : "id"
    profiles ||--o{ sales : creates
    profiles ||--o{ purchases : records
    profiles ||--o{ expenses : records
    profiles ||--o{ financial_incomes : records
    profiles ||--o{ cash_sessions : opens
    profiles ||--o{ inventory_movements : records
    profiles ||--o{ audit_logs : acts
    profiles ||--o{ sale_adjustments : authorizes

    perfumes ||--o{ retail_products : references
    perfumes ||--o{ recipes : has
    recipes ||--|{ recipe_components : defines
    materials ||--o{ recipe_components : consumed

    customers ||--o{ sales : places
    suppliers ||--o{ purchases : supplies

    sales ||--|{ sale_items : contains
    sales ||--o| sale_adjustments : reverses
    retail_products ||--o{ sale_items : sold
    recipes ||--o{ sale_items : prepared
    sale_items ||--o{ sale_material_usage : consumes
    materials ||--o{ sale_material_usage : used
    cash_sessions ||--o{ sales : settles
    cash_sessions ||--o{ cash_movements : records
    cash_sessions ||--o{ financial_incomes : receives
    cash_sessions ||--o{ sale_adjustments : refunds
    sale_adjustments ||--o| cash_movements : reverses
    expense_categories ||--o{ expenses : classifies
    payment_method_settings {
        payment_method method PK
        text label
        boolean enabled
        timestamptz updated_at
    }

    purchases ||--|{ purchase_items : contains
    materials ||--o{ purchase_items : replenishes
    retail_products ||--o{ purchase_items : replenishes
    purchase_items ||--o{ inventory_movements : posts
    sale_items ||--o{ inventory_movements : posts
    sale_adjustments ||--o{ inventory_movements : compensates
    materials ||--o{ inventory_movements : tracks
    retail_products ||--o{ inventory_movements : tracks

    expenses ||--o{ cash_movements : paid_from
    financial_incomes ||--o| cash_movements : cash_entry
    dashboard_metrics {
        timestamptz day_start
        timestamptz month_start
        jsonb role_scoped_summary
    }
    admin_operational_report {
        timestamptz period_start
        timestamptz period_end
        uuid product_filter
        uuid employee_filter
        jsonb aggregated_report
    }

    profiles {
        uuid id PK,FK
        app_role role
        text display_name
        timestamptz created_at
        timestamptz updated_at
    }
    perfumes {
        uuid id PK
        text name
        text brand
        boolean active
    }
    retail_products {
        uuid id PK
        uuid perfume_id FK
        text product_type
        text sku UK
        bigint price_cop
        numeric stock_qty
        bigint avg_unit_cost_cop
    }
    materials {
        uuid id PK
        material_unit base_unit
        numeric on_hand_qty
        bigint avg_unit_cost_cop
    }
    recipes {
        uuid id PK
        uuid perfume_id FK
        integer size_ml
        integer version
        recipe_status status
        bigint price_cop
    }
    recipe_components {
        uuid id PK
        uuid recipe_id FK
        uuid material_id FK
        component_mode mode
        numeric quantity
    }
    customers {
        uuid id PK
        text full_name
        text phone
    }
    suppliers {
        uuid id PK
        text name
        text tax_id
    }
    sales {
        uuid id PK
        bigint sale_number UK
        uuid created_by FK
        uuid customer_id FK
        uuid cash_session_id FK
        bigint total_cop
        bigint total_cost_cop
        bigint discount_cop
        payment_method payment_method
        uuid idempotency_key UK
        text request_fingerprint
    }
    sale_items {
        uuid id PK
        uuid sale_id FK
        uuid retail_product_id FK
        uuid recipe_id FK
        numeric quantity
        bigint unit_price_cop
        bigint line_cost_cop
        jsonb recipe_snapshot
    }
    sale_material_usage {
        uuid id PK
        uuid sale_item_id FK
        uuid material_id FK
        numeric quantity_used
        bigint total_cost_cop
    }
    purchases {
        uuid id PK
        uuid supplier_id FK
        uuid created_by FK
        purchase_status status
        bigint total_cop
    }
    purchase_items {
        uuid id PK
        uuid purchase_id FK
        uuid material_id FK
        uuid retail_product_id FK
        numeric quantity
        bigint unit_cost_cop
        bigint line_total_cop
    }
    inventory_movements {
        uuid id PK
        uuid material_id FK
        uuid retail_product_id FK
        uuid sale_item_id FK
        uuid purchase_item_id FK
        uuid sale_adjustment_id FK
        numeric quantity_delta
        bigint unit_cost_cop
        bigint total_cost_cop
    }
    expenses {
        uuid id PK
        uuid created_by FK
        uuid category_id FK
        bigint amount_cop
        date expense_date
        payment_method payment_method
    }
    expense_categories {
        uuid id PK
        text name UK
        boolean active
    }
    financial_incomes {
        uuid id PK
        uuid created_by FK
        uuid cash_session_id FK
        bigint amount_cop
        date income_date
        payment_method payment_method
    }
    cash_sessions {
        uuid id PK
        uuid opened_by FK
        timestamptz opened_at
        timestamptz closed_at
        bigint opening_cop
        bigint counted_cop
    }
    cash_movements {
        uuid id PK
        uuid cash_session_id FK
        uuid expense_id FK
        uuid sale_id FK
        uuid sale_adjustment_id FK
        uuid income_id FK
        bigint amount_cop
    }
    sale_adjustments {
        uuid id PK
        uuid sale_id FK,UK
        text operation
        text reason
        bigint amount_cop
        boolean inventory_restored
        payment_method refund_payment_method
        uuid cash_session_id FK
        uuid authorized_by FK
    }
    audit_logs {
        bigint id PK
        uuid actor_id FK
        text action
        text table_name
        jsonb old_data
        jsonb new_data
        timestamptz created_at
    }
```

## Relaciones y reglas de dominio

- `profiles.id` referencia uno a uno `auth.users.id`; el rol no se toma de
  `user_metadata` ni puede ser autoseleccionado por un usuario.
- `perfumes` es el catálogo de fragancias. `retail_products` guarda las
  referencias terminadas originales y 1.1 vendidas por unidad; las recetas se
  asocian al perfume y a una presentación en ml.
- Una receta tiene versiones `draft`, `active` o `archived`; solo puede haber
  una versión activa por perfume y tamaño. Para modificar una receta activa se
  crea una versión borrador, se editan sus componentes y se activa mediante
  función transaccional.
- Un componente `fixed` tiene cantidad positiva en la unidad base del material.
  Como máximo un componente puede ser `fill_to_volume` por receta; debe usar
  material `ml` y su cantidad se calcula al vender como tamaño de la receta
  menos los componentes fijos que también usan `ml`. Una cantidad no positiva
  invalida la operación. No se convierte g a ml ni se infiere una receta.
- `materials` y `retail_products` conservan existencias y costo promedio
  ponderado en COP/unidad, con redondeo explícito a COP entero. Las entradas y
  salidas se registran en `inventory_movements`; no se permiten ajustes de
  inventario sin una función transaccional autorizada.
- Cada línea de venta referencia producto terminado **o** receta (exclusivo).
  Copia nombre, presentación, precio, costo y, cuando aplica, versión y
  componentes de receta. `sale_material_usage` conserva el consumo efectivo y
  el costo de cada material. Cambios futuros no alteran la venta histórica.
- `register_pos_sale` liga cada solicitud a una clave idempotente y una huella,
  bloquea existencias concurrentes y confirma encabezado, líneas, snapshots,
  consumo, movimientos y caja en una transacción. `sale_adjustments` conserva
  anulaciones/devoluciones totales y sus movimientos compensatorios; las ventas
  no se eliminan físicamente.
- `payment_method_settings` configura etiquetas y disponibilidad de los tipos
  definidos por `payment_method`; agregar un tipo requiere migrar el enum.
- El empleado puede consultar sus ventas y registrar ventas; sus permisos SQL
  no incluyen columnas de costos, márgenes ni utilidades. `recipe_components`,
  inventario operativo y ajustes de sus propias ventas son de solo lectura;
  costos, compras, gastos, configuración y auditoría quedan restringidos al
  administrador. El empleado solo puede consultar componentes de recetas
  activas.
- `purchases`/`purchase_items` se preparan como borrador y una función registra
  su recepción junto con existencias, promedio ponderado y movimientos en una
  sola transacción.
- Las tablas de caja vinculan sesiones con ventas de todos los métodos de pago,
  ingresos adicionales, gastos en efectivo, reversiones y movimientos. Solo el
  efectivo cambia el saldo esperado y el conteo físico. Los importes de ventas
  son ingresos, no utilidades; los costos y gastos siguen sin estar disponibles
  para el rol empleado.
- `expense_categories` clasifica egresos y conserva las categorías históricas
  mediante desactivación, no borrado. `financial_incomes` separa otros ingresos
  de las ventas; únicamente un ingreso en efectivo genera un movimiento que
  cambia el efectivo esperado.
- `admin_financial_report` resume ventas netas, costos históricos de venta,
  utilidad bruta, otros ingresos y gastos por período, exclusivamente para el
  administrador. Cada sesión abierta se limita a una por usuario mediante un
  índice único parcial; el modelo actual no identifica cajas físicas distintas.
- `dashboard_metrics` calcula resúmenes acotados del día y mes, alertas de stock
  y tendencias diarias. Para empleados restringe ventas a `auth.uid()` y omite
  costos/utilidad/gastos; `admin_operational_report` valida rol administrador y
  agrega los reportes filtrados en PostgreSQL. Las devoluciones se restan del
  ingreso de venta; para filtros de producto se atribuyen proporcionalmente a
  las líneas seleccionadas, sin alterar los registros transaccionales.

## Seguridad y auditoría

RLS se habilita en todas las tablas de `public`; `anon` no recibe permisos de
tabla. Las políticas consultan un helper no expuesto por PostgREST que deriva
el rol del perfil cuyo id es exactamente `auth.uid()`. Funciones
`SECURITY DEFINER` fijan `search_path`, validan usuario/rol internamente y solo
ejecutan la operación para el propio contexto autenticado. La aplicación no
usa ni almacena claves `service_role`.

Los movimientos de inventario y los registros de auditoría son append-only
para los clientes. Triggers registran cambios administrativos de catálogo,
recetas, compras, gastos, perfiles y caja, además de las operaciones
transaccionales. Solo el administrador puede consultar el log, que puede
contener instantáneas sensibles.

## Migraciones

Las migraciones ordenadas en `supabase/migrations/` son la fuente de verdad
ejecutable. La guía de ejecución y del primer administrador está en el
`README.md` raíz.
