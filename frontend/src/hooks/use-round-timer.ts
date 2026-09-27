import { useEffect, useRef, useState } from "react";

const API_URL = import.meta.env["VITE_API_URL"] ?? "";

// Dos mediciones seguidas que difieren más que esto indican que el reloj del
// cliente se movió durante la medición. El header Date tiene resolución de 1 s,
// así que hasta ~1 s de diferencia es normal.
const MAX_MEASUREMENT_DRIFT_MS = 2000;

/**
 * Mide `servidor - cliente` con el header Date de /health, tomando el punto
 * medio del viaje de ida y vuelta. Devuelve null si no se pudo medir.
 */
async function measureOnce(): Promise<number | null> {
  const t0 = Date.now();
  const response = await fetch(`${API_URL}/health`, { cache: "no-store" });
  const t1 = Date.now();
  const serverMs = Date.parse(response.headers.get("date") ?? "");
  if (!Number.isFinite(serverMs)) return null;
  return serverMs - (t0 + (t1 - t0) / 2);
}

/**
 * Offset del reloj del servidor respecto del cliente, medido UNA sola vez al
 * montar. Si la medición falla devuelve 0, así el cronómetro sigue andando con
 * el reloj local. `onUnreliable` recibe un aviso cuando las mediciones no son
 * coherentes entre sí.
 */
export function useServerClockOffset(onUnreliable?: (message: string) => void) {
  const [offsetMs, setOffsetMs] = useState(0);
  const onUnreliableRef = useRef(onUnreliable);
  onUnreliableRef.current = onUnreliable;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const first = await measureOnce();
        const second = await measureOnce();
        if (cancelled || first === null || second === null) return;
        if (Math.abs(first - second) > MAX_MEASUREMENT_DRIFT_MS) {
          onUnreliableRef.current?.(
            "La hora de tu equipo cambió durante la sincronización. El cronómetro usa la hora local.",
          );
          return;
        }
        const offset = Math.round((first + second) / 2);
        console.info(`[run-it] offset de reloj servidor-cliente: ${offset} ms`);
        setOffsetMs(offset);
      } catch {
        // Sin /health el cronómetro sigue con el reloj local (offset 0).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return offsetMs;
}

/**
 * Cuenta regresiva basada en `ends_at` (timestamp del servidor). `serverOffsetMs`
 * viene de useServerClockOffset y se mide una sola vez, no en cada tick.
 */
export function useRoundTimer(endsAt: number, serverOffsetMs = 0) {
  const [remaining, setRemaining] = useState(() => endsAt - (Date.now() + serverOffsetMs));

  useEffect(() => {
    const tick = () => setRemaining(endsAt - (Date.now() + serverOffsetMs));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt, serverOffsetMs]);

  return Math.max(0, remaining);
}
