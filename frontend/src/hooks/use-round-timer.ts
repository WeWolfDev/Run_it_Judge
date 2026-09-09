import { useEffect, useState } from "react";

/**
 * Cuenta regresiva basada en `ends_at` (timestamp del servidor).
 * El offset servidor/cliente se aplica una sola vez al recibir round:started.
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
