import { useEffect, useRef, useState } from "react";

const API_URL = import.meta.env["VITE_API_URL"] ?? "";

// Mediciones que difieren más que esto indican que el reloj del cliente se
// movió durante la sincronización. Con el header Date (resolución de 1 s) hasta
// ~1 s de diferencia es normal.
const MAX_MEASUREMENT_DRIFT_MS = 2000;
// Se queda con la de menor ida y vuelta, como NTP: una respuesta demorada (la
// página cargando, la red) corre el punto medio y descuadra la cuenta regresiva.
const MEASUREMENTS = 4;

/**
 * Mide `servidor - cliente` con el `now` (ms) que devuelve /health, tomando el
 * punto medio del viaje de ida y vuelta. Un backend viejo no lo manda: entonces
 * se usa el header Date, que solo tiene resolución de 1 s. Devuelve null si no
 * se pudo medir.
 */
async function measureOnce(): Promise<{ offset: number; rtt: number } | null> {
  const t0 = Date.now();
  const response = await fetch(`${API_URL}/health`, { cache: "no-store" });
  const t1 = Date.now();
  const body = (await response.json().catch(() => null)) as { now?: unknown } | null;
  const serverMs =
    typeof body?.now === "number" ? body.now : Date.parse(response.headers.get("date") ?? "");
  if (!Number.isFinite(serverMs)) return null;
  return { offset: serverMs - (t0 + (t1 - t0) / 2), rtt: t1 - t0 };
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
        const samples: Array<{ offset: number; rtt: number }> = [];
        for (let i = 0; i < MEASUREMENTS; i += 1) {
          const sample = await measureOnce();
          if (sample) samples.push(sample);
        }
        if (cancelled || samples.length < 2) return;
        const offsets = samples.map((sample) => sample.offset);
        if (Math.max(...offsets) - Math.min(...offsets) > MAX_MEASUREMENT_DRIFT_MS) {
          onUnreliableRef.current?.(
            "La hora de tu equipo cambió durante la sincronización. El cronómetro usa la hora local.",
          );
          return;
        }
        const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        const offset = Math.round(best.offset);
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
    let id: ReturnType<typeof setTimeout>;
    // El próximo tick cae justo cuando cambia el segundo mostrado, no en una fase
    // propia de cada pestaña: así todos los clientes cambian de número a la vez.
    const tick = () => {
      const next = endsAt - (Date.now() + serverOffsetMs);
      setRemaining(next);
      id = setTimeout(tick, next > 0 ? (next % 1000 || 1000) + 5 : 1000);
    };
    tick();
    return () => clearTimeout(id);
  }, [endsAt, serverOffsetMs]);

  return Math.max(0, remaining);
}
