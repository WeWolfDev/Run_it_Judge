# Modo solo en GitHub Pages

El modo solo (la demo de `/practica`) se publica también como sitio estático en
GitHub Pages, separado del torneo. Corrige el código en el navegador de cada
alumno, así que no usa el backend, Judge0, Postgres ni Redis, y no le suma carga
al servidor de producción.

Dirección: `https://wewolfdev.github.io/Run_it_Judge/`.

## Qué se publica

| Pieza | Archivo |
| --- | --- |
| Configuración del build | `frontend/vite.solo.config.ts` |
| Página | `frontend/solo/index.html` (incluye la política de seguridad de contenido) |
| Entrada | `frontend/src/solo-main.tsx`: monta `SoloDemo` sin `onExit` |
| Aviso de privacidad, seguridad y créditos | `frontend/src/components/solo/SoloLegal.tsx` (`#privacidad`, `#seguridad`, `#creditos`) |
| Publicación automática | `.github/workflows/solo-pages.yml` |

Comparte el código con el Run It: `components/solo/`, el carrusel, el editor y
los sprites. Lo que se cambie en `/practica` llega también a Pages.

De `public/` se copia solo lo que usa la demo (`PUBLIC_FILES` en
`vite.solo.config.ts`): sprites, tests e íconos. El sitio es público y varias
licencias de los sprites piden no redistribuir más de lo necesario
(`CREDITS.md`). Si la demo empieza a usar otro archivo de `public/`, agregarlo
a esa lista o el sitio publicado no lo encontrará.

`base: "./"` hace que el sitio funcione en cualquier ruta, y también con un
dominio propio. Por eso las rutas de tests y sprites se arman con
`import.meta.env.BASE_URL`; en el Run It vale `/` y no cambia nada.

## Comandos

```bash
cd frontend
npm run dev:solo       # http://127.0.0.1:4100, con HMR
npm run build:solo     # genera frontend/dist-solo/ (no versionado)
npm run preview:solo   # sirve dist-solo/ en http://127.0.0.1:4100
```

El build del torneo (`npm run build`) no cambia y no toca `dist-solo/`.

## Activarlo (una sola vez)

1. Mergear a `main` la rama con el workflow.
2. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. En **Actions → Modo solo en GitHub Pages → Run workflow**, correrlo a mano la
   primera vez. Después corre solo con cada push a `main` que toque `frontend/`.

## Dominio propio (opcional)

1. En el registrador del dominio, un registro `CNAME` de `solo` (o el subdominio
   que se elija) hacia `wewolfdev.github.io`.
2. En **Settings → Pages → Custom domain**, escribir el dominio y activar
   **Enforce HTTPS** cuando GitHub emita el certificado.

No hace falta cambiar el código: con `base: "./"` funciona igual en la raíz.

## Antes de publicar un cambio

- `npm run typecheck` y `npm run lint` (los mismos 6 warnings de siempre).
- `npm run build:solo && npm run preview:solo`, y enviar una solución en C++ y
  otra en Python: la primera vez se descargan Clang (~23 MB) y Pyodide (~10 MB)
  de jsDelivr.
- Si se agrega un servicio externo (otra CDN, analítica, un backend), actualizar
  la política de seguridad en `solo/index.html` y los textos de `SoloLegal.tsx`.
  El aviso dice que no se recaban datos: un ranking o un formulario lo cambian.

## Datos del responsable

El correo de contacto y el domicilio están en `frontend/src/lib/legal.ts`. Los
usan los avisos del modo solo y `/legal/privacidad` del torneo: se cambian en un
solo lugar.
