# Perfumeria SC

Panel administrativo responsive para una perfumería, construido con React,
Vite, TypeScript, Tailwind CSS 4 y componentes con el patrón shadcn/ui.

## Requisitos

- Node.js 20.19+, 22.12+ o 24+
- npm
- Supabase CLI para migraciones locales/remotas
- Docker Desktop para ejecutar la pila local Supabase

## Inicio de la aplicación

```bash
npm install
npm run dev
```

La interfaz puede ejecutarse sin variables de entorno. `VITE_APP_NAME` es
opcional y solo personaliza el nombre visible. Para habilitar login y rutas
protegidas, copia `.env.example` a `.env.local` y configura la URL de tu
proyecto y su clave publicable (`anon`); el cliente no acepta `service_role`.
Las variables `VITE_*` se incluyen en el navegador y no son secretas.

### Acceso y recuperación

- Los usuarios se crean desde Supabase Dashboard → Authentication → Users;
  no existe formulario ni API pública de registro.
- Cada usuario necesita un registro en `public.profiles` con el mismo UUID
  de `auth.users` y rol `admin` o `employee`. El perfil es la fuente de
  autorización; nunca se confía en `user_metadata`.
- Para recuperar acceso, Authentication → URL Configuration debe permitir
  como redirect URL `http://localhost:5173/restablecer-acceso` y la URL del
  dominio publicado seguida de `/restablecer-acceso`. Configura también el
  proveedor de correo de Supabase y un mínimo de 12 caracteres en Password
  Settings. Configura las mismas variables `VITE_SUPABASE_URL` y
  `VITE_SUPABASE_PUBLISHABLE_KEY` en Cloudflare Pages o Vercel antes de compilar.
- Las funciones de Auth mantienen la sesión persistente y renuevan tokens.
  La recuperación usa un enlace de un solo uso, no revela si un correo tiene
  cuenta y exige una nueva contraseña de al menos 12 caracteres.
- El empleado solo ve Dashboard, Ventas, Inventario, Clientes y Caja. El
  administrador ve todos los módulos. Esto es una capa visual: las mismas
  restricciones se aplican en PostgreSQL mediante RLS, grants por columna y
  validaciones internas de cada función transaccional.
- El empleado puede consultar existencias operativas de materiales, pero no
  costos promedio, componentes de recetas, recetas administrativas,
  configuración, compras, gastos, informes ni auditoría. Puede registrar
  clientes y actualizar únicamente los que creó.
- Las rutas privadas redirigen al login incluso si se abren directamente.
  Manipular el router o llamar a PostgREST/RPC desde el navegador no eleva el
  rol ni concede permisos en la base de datos.
- No se incluye creación de usuarios desde el frontend. Para incorporar un
  empleado, créalo en Authentication y registra su perfil por un canal
  administrativo confiable. Nunca habilites sign-up público ni publiques
  una clave `service_role`.

## Base de datos Supabase

El modelo ER está en [docs/database-erd.md](./docs/database-erd.md). Las
migraciones SQL en `supabase/migrations/` son la fuente de verdad versionada;
no se debe cambiar el esquema manualmente en producción.

### Ejecutar localmente

```bash
npx supabase start
npx supabase db reset
npx supabase test db
```

`db reset` aplica en orden las migraciones y carga `supabase/seed.sql`. El seed
crea exclusivamente registros sintéticos identificados como `DEMO -`: 3
proveedores, 5 productos originales, 5 productos 1.1, 8 esencias, alcohol,
feromonas, 4 frascos, 8 clientes y la receta de prueba Winner Sport de 30 ml.
Los productos y materiales empiezan con existencia y costo promedio cero; no
se inventan costos de compra ni se crean movimientos sin una recepción.

La receta guarda 15 g de esencia, 1 dosis de feromonas, alcohol
`fill_to_volume` hasta 30 ml y 1 unidad del frasco atomizador de 30 ml. El
frasco es un componente explícito porque la venta debe descontarlo. Se inserta
en estado `draft` y con precio cero
porque no se especificó un precio. Un administrador debe revisar la receta,
definir su precio y activarla mediante `public.activate_recipe(uuid)` desde
una sesión autenticada antes de que pueda venderse. No se suponen conversiones
entre gramos y mililitros ni se crean otras recetas.

El seed no crea usuarios en `auth.users` o perfiles, ni incluye compras ni
ventas. `create_purchase` y `register_pos_sale` exigen un perfil y una llamada
autenticada; `receive_purchase` también exige administrador. No se simula
`auth.uid()`, no se inventan credenciales y no se insertan ventas directamente.
Para probar las 5 compras, inicia sesión con un administrador real, registra
5 compras desde el módulo y recibe cada una. Después de definir/activar la
receta y recibir existencias suficientes, registra ventas desde el módulo
Ventas o con `public.register_pos_sale(...)` usando una sesión real de
administrador o empleado. La RPC `register_sale` anterior está revocada para
evitar ventas fuera del flujo idempotente. Las ventas en efectivo requieren
una caja abierta para ese usuario. No se usa SQL Editor privilegiado para
fingir estas operaciones.

En una base local que ya tenga el fixture anterior `TEST ONLY`, ejecuta
`supabase/cleanup_demo.sql` primero y luego vuelve a cargar el seed. La limpieza
solo considera IDs determinísticos conocidos, conserva cualquier operación
posterior y aborta si detecta ediciones auditadas, stock, compras, ventas o
referencias ajenas. También limpia las filas de auditoría de inserción
generadas por esos fixtures; conserva los eventos de limpieza. Ambos scripts
abren un contexto de auditoría de mantenimiento explícito dentro de su
transacción; una falla revierte tanto los datos como la auditoría.

### Cargar, verificar y limpiar el seed local

- Carga automática: `npx supabase db reset` (recrea la base local, aplica las
  migraciones en orden y ejecuta el seed configurado).
- Para cargar sin reiniciar: usa el SQL Editor de Supabase Studio local o una
  conexión `psql` local con privilegios del proyecto y ejecuta
  `supabase/seed.sql`. No uses una conexión remota.
- Verifica que las filas visibles corresponden a los IDs y prefijos `DEMO -`:

  ```sql
  select product_type, count(*)
  from public.retail_products
  where id between '93000000-0000-4000-8000-000000000001'
                and '93000000-0000-4000-8000-000000000010'
  group by product_type
  order by product_type;

  select category, base_unit, count(*)
  from public.materials
  where id between '94000000-0000-4000-8000-000000000001'
                and '94000000-0000-4000-8000-000000000014'
  group by category, base_unit
  order by category, base_unit;

  select r.status, r.size_ml, r.price_cop, m.name, rc.mode, rc.quantity,
         m.base_unit
  from public.recipes r
  join public.recipe_components rc on rc.recipe_id = r.id
  join public.materials m on m.id = rc.material_id
  where r.id = '95000000-0000-4000-8000-000000000001'
  order by rc.id;
  ```

- Para limpiar solo los fixtures conocidos, ejecuta el contenido de
  `supabase/cleanup_demo.sql` con privilegios de la base **local**. El script
  es transaccional; si hay referencias o cambios posteriores se revierte con
  error en lugar de borrar el historial. No uses `TRUNCATE`, `DROP` ni ejecutes
  el archivo contra un proyecto remoto.

### Publicar migraciones en un proyecto Supabase

1. Crea/respalda el proyecto Supabase y desactiva **Allow new users to sign
   up** en Authentication → Settings. `supabase/config.toml` también mantiene
   deshabilitado el registro para entornos locales.
2. Inicia sesión en la CLI y enlaza el proyecto usando su referencia:

   ```bash
   npx supabase login
   npx supabase link --project-ref <PROJECT_REF>
   ```

3. Compara explícitamente el estado local con el proyecto enlazado y revisa
   qué migraciones están pendientes antes de publicarlas:

   ```bash
   npx supabase migration list --remote
   npx supabase db push --remote --dry-run
   ```

`npx supabase migration list` sin `--remote` consulta la base local en
`127.0.0.1:54322` y requiere que el stack local esté iniciado. Si no vas a
trabajar localmente, no ejecutes `supabase start` solo para revisar el estado
remoto; usa `migration list --remote`.

No uses `db reset` contra producción: elimina y reconstruye la base local.
No ejecutes `npx supabase db push --include-seed --remote`: el seed contiene
fixtures exclusivamente locales y esa opción intenta insertarlos en el
proyecto remoto. Para aplicar cambios remotos usa `npx supabase db push` sin
`--include-seed`; eso aplica las migraciones pendientes, incluida la migración
de auditoría de mantenimiento, pero no carga fixtures.

Las migraciones `20261110011800_customer_update_ownership.sql` y
`20261110011900_analytics_filter_corrections.sql` son cambios locales
pendientes de revisión y validación en PostgreSQL. No las publiques hasta que
las pruebas de base de datos pasen y se autorice su despliegue.

### Auditoría de scripts administrativos

Las migraciones transaccionales instalan triggers de auditoría que requieren
`auth.uid()` y un perfil activo. Una conexión SQL administrativa del CLI no
representa una sesión de Supabase Auth y normalmente no lleva claims JWT;
por tanto `auth.uid()` devuelve `NULL`. El error `An authenticated actor is
required for audited changes` en la carga anterior ocurrió en el primer
`INSERT` de `suppliers` del seed: lo rechazó el trigger `audit_suppliers`
porque la conexión no tenía actor autenticado ni contexto de sistema.

La migración `20261109210500_privileged_system_audit.sql` agrega un contexto
privado, explícito y limitado a la transacción/backend. `begin_system_maintenance`
solo permite conexiones PostgreSQL privilegiadas aprobadas, sin `auth.uid()`,
con `session_replication_role = origin` y un motivo requerido. El trigger
verifica el rol SQL, backend, transacción, token generado dentro de PostgreSQL
y motivo contra una tabla no expuesta; la variable de sesión por sí sola no
autoriza nada. Las filas quedan identificadas como `actor_type = 'system'`,
con `actor_id` nulo y el motivo en `system_reason`. Al terminar el script, el
contexto se cierra; si el script falla, su transacción completa se revierte.
No se deshabilitan RLS/triggers ni se simula una identidad Auth. `anon` y
`authenticated` no tienen permisos de ejecución ni acceso al contexto privado.

Para comprobar qué identidad SQL ofrece un entorno sin revelar credenciales,
ejecuta en una sesión de diagnóstico:

```sql
select session_user,
       current_user,
       auth.uid() as auth_user_id,
       current_setting('role', true) as active_sql_role,
       current_setting('session_replication_role') as replication_role;
```

No intentes resolver un fallo de permisos con `SET ROLE`, JWT/claims falsos,
desactivación de triggers/RLS ni una clave `service_role`. Ejecuta el seed y
la limpieza solo en Supabase local con el rol de base de datos confiable:
`npx supabase db reset` aplica migraciones y seed; para limpiar una base local
existente, ejecuta `supabase/cleanup_demo.sql`. Si un entorno administrativo
no satisface la validación del rol, inspecciona `session_user` y usa el
mecanismo administrativo soportado por ese entorno; no se deben ampliar los
permisos a roles de API.

La verificación de la migración y el trigger está en
`supabase/tests/database/002_system_maintenance_audit.sql` y se ejecuta con
`npx supabase test db` en una instancia local.

### Crear el primer administrador

No hay registro público ni perfil autoasignable. En Supabase Dashboard:

1. Con el registro público desactivado, crea el primer usuario en
   Authentication → Users → Add user. Conserva su UUID; no pongas contraseñas
   en SQL, migraciones, variables frontend o logs.
2. En SQL Editor, crea su perfil como administrador usando el UUID creado:

   ```sql
   insert into public.profiles (id, role, display_name)
   select id, 'admin', 'Administrador inicial'
   from auth.users
   where id = '<AUTH_USER_UUID>';
   ```

3. Para empleados, crea cada usuario de forma administrativa en Auth y añade
   el perfil con `role = 'employee'`. Nunca habilites autoasignación de rol
   desde `user_metadata` ni desde la interfaz.

La inserción inicial se realiza desde el SQL Editor privilegiado; los cambios
posteriores en perfiles quedan registrados en `audit_logs`. No se necesita ni
se debe copiar la clave `service_role` a la aplicación. La clave publicable /
`anon` tampoco sustituye RLS.

## Decisiones de seguridad y operación

- RLS está habilitado para las 18 tablas. `anon` no tiene permisos de tabla;
  las políticas usan el perfil cuyo `id` coincide con `auth.uid()`.
- Los helpers `SECURITY DEFINER` viven en el esquema privado no expuesto por
  PostgREST, fijan `search_path` y validan identidad/rol. Las operaciones
  privilegiadas públicas validan internamente el usuario antes de tocar datos.
- El empleado registra ventas y consulta sus propios comprobantes con precio
  de venta. No tiene permisos SQL para columnas de costo, instantáneas de
  receta, movimientos de materiales, compras, gastos, auditoría ni funciones
  de lectura de costos/utilidad.
- El acceso a columnas sensibles se limita con grants además de RLS. El
  inventario/costo no se modifica directamente: compras, ajustes, ventas,
  caja y gastos usan funciones transaccionales.
- `register_pos_sale` bloquea productos, recetas y materiales en orden estable,
  valida cantidades y existencias y guarda consumo, movimientos, costo/precio
  y fotografía de receta en una transacción PostgreSQL. Un error revierte toda
  la operación.
- Las recetas activas son inmutables: crear versión borrador, ajustar
  componentes/precio y activarla archiva la anterior. `fill_to_volume` solo
  admite un material `ml`, calcula el volumen restante usando componentes fijos
  también en `ml` y rechaza el volumen cero/negativo. No convierte g a ml.
- El costo promedio ponderado se calcula sobre existencias y compras y se
  redondea explícitamente a COP entero. Las cantidades permanecen `NUMERIC`;
  importes y valores monetarios almacenados son enteros COP.
- Los movimientos y logs son de solo lectura para clientes. Cambios y
  operaciones transaccionales escriben en `audit_logs`; solo admin puede
  consultar ese registro.
- El `service_role` no se usa en frontend ni se guarda en variables `VITE_*`.
  Todo secreto de servidor debe mantenerse fuera del cliente y del repositorio.

## Aplicación

Los módulos de productos, inventario, compras y proveedores están conectados a
Supabase y solo son accesibles para administradores, salvo la consulta
operativa de existencias e historial permitida al empleado. El catálogo no
edita existencias ni costos; las compras se guardan como borrador y solo la
recepción transaccional modifica stock, movimientos y costo promedio
ponderado. Los registros vinculados a movimientos se conservan; los
proveedores se pueden desactivar sin borrar su historial. En registros de
catálogo preexistentes sin marca asociada, la migración usa el marcador
«Marca pendiente» para revisión administrativa, sin inferir una marca real.

### Recetas y fabricación bajo pedido

La sección **Recetas** permite al administrador crear fórmulas separadas por
perfume y presentación (30, 50, 60 o 100 ml), definir precios en COP y guardar
versiones borrador. Las versiones activas no se editan: se crea una nueva
versión, se modifica y se activa para conservar el historial. Para activar una
presentación, la fórmula debe incluir el frasco atomizador correspondiente.
Las unidades configuradas para los materiales se mantienen tal cual (g, ml,
unit o dose); no se convierten gramos a mililitros.

El empleado solo consulta fórmulas activas y puede registrar su fabricación
asociada a una venta. Si hay un componente `fill_to_volume`, la pantalla exige
el volumen real medido en ml por frasco antes de confirmar. La RPC
`register_pos_sale` valida identidad, fórmula activa, frasco correcto,
consumo medido, existencias, caja y pago; en una sola transacción crea la
venta, conserva la receta/costos/materiales usados y descuenta ingredientes y
frascos. No crea ni incrementa stock de réplicas terminadas. La antigua RPC
`register_recipe_manufacture` está revocada para concentrar las ventas en el
flujo idempotente.

Los administradores ven costo estimado, utilidad y margen con los costos
promedio actuales. Si la fórmula tiene un componente variable, esas cifras
solo se completan después de ingresar su medición real; el costo histórico de
la fabricación se conserva en la venta. Los empleados no reciben permisos
para leer costos, utilidades ni auditoría.

El seed local incluye el ejemplo **DEMO - Winner Sport, 30 ml** como borrador
editable: 15 g de esencia, 1 dosis de feromonas, alcohol `fill_to_volume` y
1 frasco de 30 ml. No se crean fórmulas para otras presentaciones. Para
publicar, aplica las migraciones versionadas hasta
`supabase/migrations/20261110002700_financial_module.sql`; no uses
`--include-seed` en el proyecto remoto.

### Punto de venta

La pantalla **Ventas** registra originales y productos 1.1 por unidades, y
réplicas solo mediante una receta activa con la presentación correspondiente.
El carrito mantiene los cambios localmente y no descuenta existencias hasta
que PostgreSQL confirma la RPC transaccional `register_pos_sale`. Para
componentes `fill_to_volume`, se solicita el consumo real por frasco, sin
conversiones implícitas. Las existencias se vuelven a validar bajo bloqueo de
filas; la operación completa, su instantánea de receta/costo/precio, los
movimientos de inventario y el ingreso de caja se confirman o revierten en
una sola transacción.

Cada intento conserva una clave idempotente y una huella de la solicitud:
reintentar el mismo payload devuelve la venta ya creada, mientras reutilizar
la clave con otra solicitud se rechaza. Solo administradores pueden aplicar
descuentos, configurar las etiquetas/habilitación de los cuatro métodos
definidos por el enum actual, y anular o devolver ventas. Ambas operaciones
revierten el valor total del pago, registran un ajuste y nunca borran la venta.
La devolución monetaria en efectivo se registra como salida de caja del
administrador; una reversión por otro método queda registrada y la operación
externa debe completarse fuera de la aplicación. La restauración de inventario
es opcional y debe seleccionarse únicamente si el producto/material fue
recibido y es reutilizable; sus movimientos compensatorios conservan el costo
histórico y recalculan el costo promedio ponderado. No hay devoluciones
parciales ni tipos de pago nuevos sin una migración del enum.

El historial muestra las últimas 100 ventas visibles para el usuario según
RLS. Empleados no reciben permisos para leer costos, utilidades ni ajustes de
ventas ajenas. Los comprobantes pueden imprimirse desde el navegador.

Comprobaciones del frontend:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Para Cloudflare Pages o Vercel, publicar el directorio `dist` generado por
`npm run build`.

Las pruebas de permisos de recetas y punto de venta se encuentran en
`supabase/tests/database/003_recipes_security.sql` y
`supabase/tests/database/004_point_of_sale_security.sql`, y se ejecutan
localmente con `npx supabase test db`. La cobertura del adaptador cliente está
en `src/features/sales/data.test.ts`.

### Caja, gastos e informes financieros

La sección **Caja** permite abrir y cerrar una sesión con saldo inicial,
observaciones, ingresos adicionales, retiros de efectivo y conteo físico. Solo
puede existir una sesión abierta por usuario. El efectivo esperado se calcula
con apertura, ventas en efectivo, ingresos en efectivo, gastos pagados en
efectivo y retiros; transferencias, tarjetas y otros medios se asocian a la
sesión para informar ventas por método, pero no se suman al efectivo contado.
Toda venta exige una caja abierta y queda enlazada a su sesión en PostgreSQL.

Los **Gastos** son exclusivos del administrador y usan categorías editables;
Arriendo, Servicios, Transporte, Empaques y Otros se crean inicialmente.
Las categorías con historial se desactivan en vez de eliminarse. Los ingresos
adicionales y movimientos de caja registran usuario, concepto, fecha, valor y
observaciones. La interfaz usa RPCs transaccionales con validación de usuario,
rol, método de pago habilitado y sesión abierta. RLS limita la lectura de caja
al propietario de la sesión o al administrador; solo el administrador puede
consultar gastos y reportes de utilidad.

**Informes** permite períodos de día, semana, mes o fechas personalizadas
(máximo 366 días). Separa ventas netas, costo histórico de venta, utilidad
bruta, otros ingresos, gastos operativos y resultado neto. La utilidad usa el
costo guardado en cada venta, no el costo promedio actual. No equivale al
importe de ventas ni incluye el saldo de efectivo.

La migración `supabase/migrations/20261110002700_financial_module.sql` aún debe
aplicarse en cada entorno. No se ejecutó ni publicó desde este cambio. Las
pruebas de privilegios están en
`supabase/tests/database/005_financial_security.sql`.

### Dashboard e informes operativos

El dashboard usa la RPC `dashboard_metrics` para calcular indicadores en
PostgreSQL a partir de ventas reales, inventario activo y sesiones de caja. El
empleado solo recibe sus propias ventas, alertas operativas y datos de caja
permitidos; las claves/campos de utilidad, costos y gastos son nulos para ese
rol. Los administradores pueden consultar métricas de utilidad calculadas con
el costo histórico conservado por venta.

La sección **Informes** es exclusiva para el administrador y agrega datos en
PostgreSQL mediante `admin_operational_report`. Permite rango de fechas de
hasta 366 días, agrupación diaria/semanal/mensual, producto, categoría y
empleado. Incluye ventas por tipo y método, comparación con el período anterior
de igual duración, productos, consumo real de materiales, compras, gastos y
movimientos de caja. Las consultas agregadas no descargan el historial completo
al navegador. Los informes pueden exportarse a CSV e imprimirse; la impresión
de comprobantes de venta se mantiene en el punto de venta.

Las devoluciones registradas se descuentan del ingreso neto y las anulaciones
con inventario restaurado no aportan costo reconocido. Cuando se filtra por
producto/categoría y la devolución está registrada a nivel de venta, el RPC
distribuye su valor proporcionalmente sobre el importe neto de las líneas
seleccionadas; es una atribución solo para análisis, no modifica las ventas ni
sus movimientos contables.

`supabase/migrations/20261110005300_dashboard_analytics.sql` crea estas RPCs.
Debe aplicarse después de las migraciones existentes; no se ha enviado al
proyecto remoto. La prueba de permisos está en
`supabase/tests/database/006_dashboard_analytics_security.sql`.
