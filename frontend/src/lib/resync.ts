// Volver a ponerse al día sin F5. Cuando la pantalla vuelve después de estar
// fuera, lo que muestra puede estar viejo: los timers en segundo plano se
// frenan (Chrome y Edge los limitan a uno por minuto en Mac y Windows), la
// suspensión (tapa cerrada en Mac, suspender en Windows) corta el socket sin
// avisar, Safari restaura la página desde el caché atrás/adelante con el
// socket muerto, y la red puede caerse y volver. Este módulo junta esas
// señales en un solo aviso para que cada vista vuelva a pedir lo suyo.

export type ResyncInfo = {
  /** Cuánto estuvo fuera la página (oculta o sin red), en ms. 0 si no se sabe. */
  awayMs: number;
};

type Listener = (info: ResyncInfo) => void;

const listeners = new Set<Listener>();
/** Un foco y un visibilitychange llegan juntos: se cuentan como uno. */
const MIN_GAP_MS = 2000;
let installed = false;
let lastFired = 0;
let awaySince: number | null = null;

function fire() {
  const now = Date.now();
  const awayMs = awaySince === null ? 0 : now - awaySince;
  awaySince = null;
  if (now - lastFired < MIN_GAP_MS) return;
  lastFired = now;
  listeners.forEach((listener) => listener({ awayMs }));
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") awaySince ??= Date.now();
    else fire();
  });
  window.addEventListener("offline", () => {
    awaySince ??= Date.now();
  });
  window.addEventListener("online", fire);
  // persisted: la página vuelve del caché atrás/adelante (Safari, Firefox).
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) fire();
  });
  // Alt+Tab o Cmd+Tab entre ventanas no siempre oculta la pestaña.
  window.addEventListener("focus", fire);
}

/** Avisa cada vez que la página vuelve. Devuelve la función para dejar de escuchar. */
export function onResync(listener: Listener) {
  install();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
