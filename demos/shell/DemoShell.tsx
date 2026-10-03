import { useEffect, useState, type ReactNode } from "react";
import { addBotParticipant, botsAreEnabled, demo, resetDemo, setBotsEnabled } from "../fake/backend";
import { PixelIcon } from "@/components/PixelIcon";
import { applyPixelCursor } from "@/lib/pixel-cursor";
import { onSoundChange, setSoundOn, soundOn } from "@/lib/sfx";

// DEMO: paletas elegibles por cada usuario. Se guardan en su navegador.
export const PALETTES = [
  { id: "arcade", name: "Arcade Neón" },
  { id: "marquesina", name: "Marquesina" },
  { id: "lavanda", name: "Lavanda Koala" },
  { id: "", name: "Original" },
] as const;
const PALETTE_KEY = "run-it-palette";

export function storedPalette() {
  try {
    return localStorage.getItem(PALETTE_KEY) ?? "arcade";
  } catch {
    return "arcade";
  }
}

// Se llama antes del primer render: así no se ve la paleta por defecto un instante.
export function applyPalette(id: string) {
  if (id) document.documentElement.dataset["palette"] = id;
  else delete document.documentElement.dataset["palette"];
  try {
    localStorage.setItem(PALETTE_KEY, id);
  } catch {
    /* sin almacenamiento */
  }
  // El cursor se redibuja con los colores nuevos cuando el CSS ya los aplicó.
  requestAnimationFrame(applyPixelCursor);
}

// Barra de navegación de src/routes/__root.tsx, con paleta y sonido.
function Header({ role }: { role: "admin" | "participant" }) {
  const [palette, setPalette] = useState(storedPalette);
  const [sound, setSound] = useState(soundOn);
  useEffect(() => onSoundChange(() => setSound(soundOn())), []);
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
        <span
          className="text-sm text-primary"
          style={{ fontFamily: "'Press Start 2P', ui-monospace, monospace" }}
        >
          Run&nbsp;It
        </span>
        <nav className="flex items-center gap-2 text-sm text-muted-foreground">
          <PixelIcon name={role === "admin" ? "gamepad" : "flag"} className="h-4 w-4 text-primary" />
          <span className="font-medium text-foreground">
            {role === "admin" ? "Administración" : "Mi carrera"}
          </span>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2 text-muted-foreground">
            Paleta
            <select
              value={palette}
              onChange={(event) => {
                setPalette(event.target.value);
                applyPalette(event.target.value);
              }}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-ring"
            >
              {PALETTES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setSoundOn(!sound)}
            aria-pressed={sound}
            className="rounded-md border border-border px-2 py-1 text-muted-foreground hover:text-foreground"
          >
            Sonido: {sound ? "sí" : "no"}
          </button>
          <span className="text-muted-foreground">Salir</span>
        </div>
      </div>
    </header>
  );
}

const btn =
  "rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40";

// Panel flotante de la demo: no es parte de la app.
function DemoControls({ role }: { role: "admin" | "participant" }) {
  const [open, setOpen] = useState(true);
  const [, setTick] = useState(0);
  const [note, setNote] = useState("");
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);
  const t = demo.tournaments().find((x) => x.status !== "finished");
  const rounds = t ? demo.rounds().filter((r) => r.tournament_id === t.id).sort((a, b) => a.round_number - b.round_number) : [];
  const active = rounds.find((r) => r.status === "active");
  const pending = rounds.find((r) => r.status === "pending");
  const lastClosed = [...rounds].reverse().find((r) => r.status === "closed");
  const nextIsPlanned = lastClosed && pending && pending.round_number === lastClosed.round_number + 1;
  return (
    <aside className="fixed bottom-4 right-4 z-50 w-72 rounded-xl border-2 border-dashed border-primary bg-card/95 p-3 text-xs text-foreground shadow-xl backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold uppercase tracking-wide text-primary">
          {role === "admin" ? "Simulación de la demo" : "Simular al organizador"}
        </p>
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)}>
          {open ? "Ocultar" : "Mostrar"}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-muted-foreground">
            No es parte de la app: reemplaza al {role === "admin" ? "resto de los participantes" : "admin y al resto de los participantes"}.
          </p>
          {t && (
            <p>
              <b>{t.name}</b> ·{" "}
              {active
                ? `ronda ${active.round_number} ${active.paused ? "pausada" : "en curso"}`
                : pending
                  ? `ronda ${pending.round_number} pendiente`
                  : "sin rondas abiertas"}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {role === "participant" && (
              <>
                <button type="button" className={btn} disabled={!pending || Boolean(active) || Boolean(demo.startBlock(pending.id))} onClick={() => pending && demo.start(pending.id)}>
                  Iniciar ronda {pending?.round_number ?? ""}
                </button>
                <button type="button" className={btn} disabled={!active} onClick={() => active && demo.pause(active.id)}>
                  {active?.paused ? "Reanudar" : "Pausar"}
                </button>
                <button type="button" className={btn} disabled={!active} onClick={() => active && demo.close(active.id)}>
                  Cerrar ronda
                </button>
                <button
                  type="button"
                  className={btn}
                  disabled={!lastClosed || Boolean(active) || (Boolean(pending) && !nextIsPlanned)}
                  onClick={() => lastClosed && setNote(demo.nextRound(lastClosed.id) ?? "Clasificados inscriptos en la ronda siguiente.")}
                >
                  Avanzar clasificados
                </button>
              </>
            )}
            {role === "admin" && (
              <button type="button" className={btn} onClick={() => setNote(addBotParticipant() ? "Se conectó un participante." : "No hay códigos libres o ronda abierta.")}>
                + Se conecta un participante
              </button>
            )}
            <button type="button" className={btn} onClick={() => { setBotsEnabled(!botsAreEnabled()); setTick((x) => x + 1); }}>
              Bots enviando: {botsAreEnabled() ? "sí" : "no"}
            </button>
            <button type="button" className={`${btn} border-danger text-danger`} onClick={resetDemo}>
              Reiniciar demo
            </button>
          </div>
          {note && <p className="text-muted-foreground">{note}</p>}
        </div>
      )}
    </aside>
  );
}

export function DemoShell({ role, children }: { role: "admin" | "participant"; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background font-sans">
      <Header role={role} />
      <div className="mx-auto max-w-7xl px-5 pb-72 pt-8">{children}</div>
      <DemoControls role={role} />
    </div>
  );
}
