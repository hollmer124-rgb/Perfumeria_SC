# Perfumeria SC

Interfaz administrativa responsive para una perfumería. Esta base técnica usa
React, Vite, TypeScript, Tailwind CSS 4, componentes shadcn/ui, React Router y
React Query.

## Requisitos

- Node.js 20.19+, 22.12+ o 24+
- npm

## Inicio local

```bash
npm install
cp .env.example .env.local
npm run dev
```

La copia de `.env.local` es opcional: la aplicación ya tiene valores
predeterminados para mostrarse sin variables configuradas.

## Variables de entorno

`VITE_APP_NAME` personaliza el nombre mostrado en la interfaz. Las variables
con prefijo `VITE_` se exponen al navegador, por lo que nunca se deben usar
para contraseñas, claves privadas o secretos.

Esta versión no se conecta a una base de datos ni a servicios externos. No
requiere claves para ejecutarse.

## Comprobaciones

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Estructura

- `src/components`: shell adaptable y componentes reutilizables de interfaz.
- `src/features`: funcionalidades por dominio; actualmente dashboard y
  navegación.
- `src/hooks`: hooks de interfaz compartidos.
- `src/lib`: configuración pública, utilidades y notificaciones.
- `src/pages`: pantallas de rutas.
- `src/routes`: composición de React Router y React Query.
- `src/types`: tipos compartidos entre funcionalidades.

Los componentes UI siguen el patrón de shadcn/ui y su configuración está en
`components.json`. Las rutas de funcionalidades están en español:

`/dashboard`, `/ventas`, `/productos`, `/inventario`, `/recetas`, `/compras`,
`/clientes`, `/proveedores`, `/gastos`, `/caja`, `/informes` y
`/configuracion`.

## Alcance actual

El dashboard, los estados vacíos y las rutas de módulos son provisionales. No
se generan datos de muestra ni se simula persistencia. Los componentes de
formularios, tablas, diálogos y notificaciones están disponibles para las
siguientes fases, pero aún no ejecutan operaciones de negocio.

Para Cloudflare Pages o Vercel, compilar con `npm run build` y publicar el
directorio `dist`. El fallback SPA existente permite cargar rutas internas
directamente.
