# Cómo contribuir a Run It

🌐 **Español** · [English](#english)

¡Gracias por querer sumar! Run It es un proyecto con **todos los derechos
reservados** (ver [`LICENSE`](LICENSE)): se puede contribuir, pero no copiar ni
reusar el código en otro lado.

## Antes de empezar

- Para algo más grande que un arreglo chico, abrí primero un
  [issue](https://github.com/WeWolfDev/Run_it_Judge/issues) y contá qué querés
  hacer. Así no trabajás en algo que no se va a mergear.
- Leé [`CLAUDE.md`](CLAUDE.md) y [`DEVELOPMENT_COMMANDS.md`](DEVELOPMENT_COMMANDS.md):
  explican cómo levantar el entorno y las reglas del repo.

## Flujo

1. Hacé un fork en GitHub y creá una rama desde `main`:
   `feat/…`, `fix/…`, `docs/…`.
2. Commits en [Conventional Commits](https://www.conventionalcommits.org/), en
   inglés, imperativo y minúsculas:

   ```text
   feat: add round pause button
   fix: keep qualifiers after reconnect
   ```

   Tipos válidos: `feat`, `fix`, `docs`, `chore`, `style`, `refactor`, `test`, `perf`.
3. Corré las verificaciones (no hay CI):

   ```bash
   cd frontend && npm run typecheck && npm run lint
   cd ../run-it-backend && npm test
   ```

4. Abrí el pull request contra `main` con qué cambia y cómo lo probaste.

## Estilo

- **Frontend:** TypeScript, 2 espacios, comillas dobles, punto y coma, ancho 100.
- **Backend:** JavaScript CommonJS, tabulaciones, comillas simples.
- Textos de la interfaz y comentarios, **en español**.
- Sin dependencias nuevas sin justificarlas en el PR.
- Tests nuevos sin base de datos, o con una base propia. Nunca contra `run_it`.

## No se aceptan

- Secretos, contraseñas, `judge0.conf` o `run-it-backend/secrets`.
- Sprites, fuentes o sonidos sin licencia clara. Si agregás un recurso de
  terceros, sumalo a [`CREDITS.md`](CREDITS.md) y a `frontend/src/lib/credits.ts`.
- Reescribir historia publicada: nada de `force push`, `rebase` ni `squash`
  sobre commits ya subidos.

## Derechos sobre tu aporte

Al abrir un pull request declarás que:

1. El aporte es tuyo, o tenés derecho a enviarlo.
2. **Cedés a WeWolfDev**, sin costo, de forma perpetua e irrevocable, el derecho
   a usar, modificar, distribuir, sublicenciar y relicenciar tu aporte como parte
   de Run It o de cualquier versión futura, bajo la licencia que WeWolfDev elija.
3. No recibís a cambio derechos sobre el resto del código: el fork sirve solo
   para proponer cambios a este repositorio.

Tu nombre queda en el historial de git como autor del cambio.

---

## English

Run It is **all rights reserved** (see [`LICENSE`](LICENSE)): you can
contribute, but not copy or reuse the code elsewhere.

1. For anything beyond a small fix, open an issue first.
2. Fork, branch from `main`, and use Conventional Commits in English.
3. Run `npm run typecheck && npm run lint` in `frontend/` and `npm test` in
   `run-it-backend/` (there is no CI).
4. Open a pull request against `main`. UI text and code comments stay in Spanish.

By opening a pull request you confirm the contribution is yours to submit, and
you grant WeWolfDev a free, perpetual and irrevocable right to use, modify,
distribute, sublicense and relicense it as part of Run It. Your fork may be used
only to propose changes to this repository.
