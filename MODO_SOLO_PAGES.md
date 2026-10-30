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
| Aviso de privacidad, términos, seguridad y créditos | `frontend/src/components/solo/SoloLegal.tsx` (`#privacidad`, `#terminos`, `#seguridad`, `#creditos`) |
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
  El aviso describe exactamente qué guarda la cuenta (apodo y progreso): un
  ranking público, un formulario o un dato nuevo lo cambian.
- `#privacidad` y `#terminos` están registrados en la pantalla de consentimiento
  de Google: si cambian esas direcciones, actualizarlas allá también.

## Mapa de aprendizaje

Después de *Press start* se abre el mapa (`frontend/src/components/solo/aprende/`):
mundos con temas, cada tema con su lección, una animación paso a paso y
ejercicios sin reloj, más la contrarreloj de siempre y el ranking global.

| Pieza | Dónde |
| --- | --- |
| Mundos, temas, lecciones y enunciados | `aprende/content.ts` |
| Soluciones de referencia y generadores de casos | `aprende/solutions.ts` |
| Casos de prueba (no editar a mano) | `public/solo-tests/ini-*.json` |
| Animaciones de las lecciones | `aprende/animations.tsx` |
| Progreso (navegador y cuenta) | `aprende/useProgress.ts` |
| Catálogo de puntos y ranking en Supabase | `deploy/supabase/003_solo_mapa_y_ranking.sql` |

Para agregar un ejercicio:

1. Su solución, sus ejemplos y su generador en `solutions.ts`.
2. Su enunciado y sus puntos en `content.ts`, dentro de un tema.
3. `npm run aprende:tests` para escribir el JSON de casos.
4. Una fila en `ejercicios` con los mismos puntos, en un script SQL nuevo
   (`004_...`). Sin esa fila, el progreso de ese ejercicio no se guarda en la
   cuenta (la clave foránea lo rechaza) aunque sí en el navegador.

Solo el mundo Principiante tiene temas (temario provisional); Intermedio y
Avanzado se ven bloqueados como "próximamente".

## Cuentas (opcional)

Se juega sin cuenta. Con cuenta se guarda un apodo y, cuando exista el roadmap,
el progreso. Las guarda Supabase (proyecto `qyqodhnhltiyzzzdekoy`); el sitio
sigue siendo estático.

| Pieza | Dónde |
| --- | --- |
| Cliente y clave publishable | `frontend/src/lib/solo-supabase.ts` |
| Estado de la cuenta | `frontend/src/components/solo/account/useAccount.ts` |
| Botón, apodo, cerrar sesión, borrar cuenta | `frontend/src/components/solo/account/SoloAccount.tsx` |
| Tablas, permisos, RLS y `borrar_mi_cuenta()` | `deploy/supabase/001_solo_cuentas_y_progreso.sql` |
| Límites (formato del tema, 300 temas por cuenta, columnas editables) | `deploy/supabase/002_solo_limites.sql` |
| Catálogo de ejercicios, ranking opcional (`ranking_global`, `mi_ranking`) | `deploy/supabase/003_solo_mapa_y_ranking.sql` |

Configuración del proyecto en Supabase (ya hecha; anotarla si se rehace):

- **SQL Editor:** correr en orden `001_solo_cuentas_y_progreso.sql`,
  `002_solo_limites.sql` y `003_solo_mapa_y_ranking.sql`, de `deploy/supabase/`.
  Se puede volver a correr. Un cambio de esquema va en un archivo nuevo
  (`002_...`), nunca editando el anterior.
- **Data API** activada y **Automatically expose new tables** apagada: cada
  tabla nueva necesita su `grant` y sus políticas, como en el script.
- **Automatic RLS** activado.
- **Sign In / Providers:** GitHub (con *Allow users without an email*) y Google
  activados; **Email desactivado**.
- **URL Configuration:** Site URL `https://wewolfdev.github.io/Run_it_Judge/`;
  Redirect URLs `https://wewolfdev.github.io/Run_it_Judge/**` y
  `http://127.0.0.1:4100/**`.
- La app de GitHub (OAuth App) y el cliente de Google apuntan a
  `https://qyqodhnhltiyzzzdekoy.supabase.co/auth/v1/callback`.

Nunca va en el repo la clave secreta (`sb_secret_...` o `service_role`) ni los
client secrets de GitHub o Google: viven solo en el panel de Supabase.

El plan gratuito de Supabase pausa el proyecto tras un tiempo sin uso. Si el
login deja de responder después de vacaciones, reactivarlo desde el panel.

## Datos del responsable

El correo de contacto y el domicilio están en `frontend/src/lib/legal.ts`. Los
usan los avisos del modo solo y `/legal/privacidad` del torneo: se cambian en un
solo lugar.
