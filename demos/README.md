# Demos de Run It

Copia del frontend con un backend simulado en el navegador, para probar cambios
de diseño y de flujo antes de pasarlos al código. No está en git.

- `src/`: copia de `frontend/src` (componentes, lib, hooks, estilos). Los cambios
  propuestos están marcados con `DEMO` en comentarios.
- `fake/backend.ts`: intercepta `fetch` y responde las rutas de
  `run-it-backend/index.js`, con participantes simulados y juez simulado.
  También tiene rutas que el backend real todavía no tiene (plan de rondas,
  sala de espera); están marcadas como propuesta.
- `fake/socket.ts`: reemplazo de `socket.io-client` (bus en memoria).
- `shell/DemoShell.tsx`: barra de navegación y panel flotante de simulación.
- `admin/`, `participante/`: entradas de cada demo.

## Compilar

```bash
cd demos
DEMO=admin ./node_modules/.bin/vite build --config vite.config.mjs
DEMO=participante ./node_modules/.bin/vite build --config vite.config.mjs
python3 publish.py admin && python3 publish.py participante
../frontend/node_modules/.bin/tsc -p tsconfig.json   # tipos
```

`node_modules` es un enlace a `../frontend/node_modules`. `publish.py` deja en
`dist/<demo>/page.html` la página lista para publicar y en `files.json` los
archivos que la acompañan.
