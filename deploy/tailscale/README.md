# Publicación gratuita con Tailscale Funnel

Esta es la ruta de coste cero para publicar la instalación de Run It sin abrir puertos del router, sin IP pública y sin comprar un dominio.

## Preflight

```bash
curl -fsS http://127.0.0.1:3001/health
curl -fsS http://127.0.0.1:3001/ready
curl -fsSI http://127.0.0.1:3002/login
```

El proxy local de Nginx debe estar instalado desde `deploy/nginx/runit-tailscale.conf` y escuchando únicamente en `127.0.0.1:8080`.

## Activar el túnel

1. Iniciar sesión una vez en Tailscale.
2. Ejecutar como el usuario administrador de Tailscale:

```bash
bash deploy/tailscale/configure-funnel.sh
```

3. Copiar la URL HTTPS mostrada por `tailscale funnel status`.
4. Añadir ese origen a `ALLOWED_ORIGINS` en el archivo root-only `run-it-backend/secrets`, conservando los orígenes já existentes:

```text
ALLOWED_ORIGINS=https://<equipo>.<tailnet>.ts.net,https://runit.gelatina.lat
```

5. Reiniciar el backend y comprobar readiness.

## Comprobaciones

```bash
tailscale status
tailscale funnel status
curl -fsS https://<equipo>.<tailnet>.ts.net/health
curl -fsS https://<equipo>.<tailnet>.ts.net/ready
curl -fsSI https://<equipo>.<tailnet>.ts.net/login
```

## Límites y seguridad

- Tailscale Funnel es un servicio beta y tiene límites de ancho de banda no configurables.
- La URL es pública: cualquiera que la conozca puede intentar acceder al login.
- No se deben abrir `3001`, `3002`, `2358`, `5433` o `6380` en el router.
- La computadora debe permanecer encendida, conectada y sin suspensión.
- Judge0 ejecuta código de participantes y conserva un riesgo alto aunque el túnel sea HTTPS.
- El túnel no sustituye una revisión de seguridad ni un plan de respaldos.
