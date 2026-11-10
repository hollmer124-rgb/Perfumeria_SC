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

`db reset` aplica en orden las migraciones y carga `supabase/seed.sql`. Sus
registros están marcados `TEST ONLY`, son ficticios, tienen existencias cero y
se cargan únicamente al reiniciar una base local. La receta demo no es una
fórmula válida para fabricar ni debe copiarse a datos reales.

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
`db push` ejecuta únicamente migraciones no aplicadas. El archivo seed local no
se publica con `db push`.

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

Comprobaciones del frontend:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Para Cloudflare Pages o Vercel, publicar el directorio `dist` generado por
`npm run build`.
