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
ventas. `create_purchase` y `register_sale` exigen un perfil y una llamada
autenticada; `receive_purchase` también exige administrador. No se simula
`auth.uid()`, no se inventan credenciales y no se insertan ventas directamente.
Para probar las 5 compras, inicia sesión con un administrador real, registra
5 compras desde el módulo y recibe cada una. Después de definir/activar la
receta y recibir existencias suficientes, las ventas solo pueden registrarse
llamando `public.register_sale(jsonb, public.payment_method, uuid, uuid, text)`
desde un cliente con una sesión real de administrador o empleado. El módulo
Ventas y el módulo Recetas aún están en preparación; no se afirma que sus
pantallas permitan esas operaciones. Las ventas en efectivo también requieren
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

3. Revisa las migraciones pendientes y publícalas:

   ```bash
   npx supabase migration list
   npx supabase db push
   ```

No uses `db reset` contra producción: elimina y reconstruye la base local.
No ejecutes `npx supabase db push --include-seed --remote`: el seed contiene
fixtures exclusivamente locales y esa opción intenta insertarlos en el
proyecto remoto. Para aplicar cambios remotos usa `npx supabase db push` sin
`--include-seed`; eso aplica las migraciones pendientes, incluida la migración
de auditoría de mantenimiento, pero no carga fixtures.

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
- `register_sale` bloquea productos, recetas y materiales en orden estable,
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
`register_recipe_manufacture` vuelve a validar el usuario, fórmula activa,
frasco correcto, cantidad medida, existencias, caja y pago, y en una sola
transacción crea la venta, guarda la receta/costos/materiales usados y
descuenta ingredientes y frascos. No crea ni incrementa stock de réplicas
terminadas. El RPC anterior de ventas rechaza fórmulas con consumo variable
para impedir que se omita el volumen medido.

Los administradores ven costo estimado, utilidad y margen con los costos
promedio actuales. Si la fórmula tiene un componente variable, esas cifras
solo se completan después de ingresar su medición real; el costo histórico de
la fabricación se conserva en la venta. Los empleados no reciben permisos
para leer costos, utilidades ni auditoría.

El seed local incluye el ejemplo **DEMO - Winner Sport, 30 ml** como borrador
editable: 15 g de esencia, 1 dosis de feromonas, alcohol `fill_to_volume` y
1 frasco de 30 ml. No se crean fórmulas para otras presentaciones. Al cargar
o desplegar migraciones, aplica
`supabase/migrations/20261109210600_recipes_on_demand_manufacturing.sql`; no
uses `--include-seed` en el proyecto remoto.

Comprobaciones del frontend:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Para Cloudflare Pages o Vercel, publicar el directorio `dist` generado por
`npm run build`.

Las pruebas de permisos y fabricación de recetas se encuentran en
`supabase/tests/database/003_recipes_security.sql` y se ejecutan localmente con
`npx supabase test db`.
