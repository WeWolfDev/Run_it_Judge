import "@/styles.css";
import "./premios.css";

const { createRoot } = await import("react-dom/client");
const { useEffect, useMemo, useState } = await import("react");
const { PALETTES, applyPalette, storedPalette } = await import("../shell/DemoShell");
const { PixelIcon } = await import("@/components/PixelIcon");
const { onSoundChange, setSoundOn, soundOn } = await import("@/lib/sfx");
const { cn } = await import("@/lib/utils");
const { playTournament, CAPACITIES } = await import("./torneo");
const { computeAwards } = await import("./awards");
const { Ceremony } = await import("./Ceremony");
applyPalette(storedPalette());

type Phase = import("./Ceremony").Phase;
type View = "pista" | "participante" | "admin";

// DEMO: las tres pantallas comparten el mismo estado de la ceremonia, como
// pasaría con el evento por Socket.io que mande el panel del admin.
function App() {
  const [seed, setSeed] = useState(14);
  const [view, setView] = useState<View>("pista");
  const [phase, setPhase] = useState<Phase>({ kind: "winner" });
  const { rounds, subs } = useMemo(() => playTournament(seed), [seed]);
  const awards = useMemo(() => computeAwards(rounds, subs), [rounds, subs]);

  const next = () =>
    setPhase((p) => {
      if (p.kind === "winner") return { kind: "intro" };
      if (p.kind === "intro") return { kind: "award", index: 0 };
      if (p.kind === "award") return p.index + 1 < awards.length ? { kind: "award", index: p.index + 1 } : { kind: "end" };
      return p;
    });

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <DemoBar
        view={view}
        onView={setView}
        onRestart={() => setPhase({ kind: "winner" })}
        onNext={phase.kind === "end" ? undefined : next}
        onNewTournament={() => {
          setSeed((s) => s + 1);
          setPhase({ kind: "winner" });
        }}
      />
      <div className="min-h-0 flex-1">
        {view === "pista" && (
          <div className="h-full p-[2vmin]">
            <Ceremony phase={phase} awards={awards} />
          </div>
        )}
        {view === "participante" && <ParticipantFrame phase={phase} awards={awards} />}
        {view === "admin" && <AdminProgress rounds={rounds} awards={awards} phase={phase} onNext={next} />}
      </div>
    </div>
  );
}

// Vista del participante: la misma ceremonia dentro de su pantalla.
function ParticipantFrame({ phase, awards }: { phase: Phase; awards: ReturnType<typeof computeAwards> }) {
  return (
    <div className="h-full overflow-auto">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-5 py-3 text-sm">
          <span className="text-primary" style={{ fontFamily: "'Press Start 2P', monospace" }}>
            Run&nbsp;It
          </span>
          <span className="flex items-center gap-1.5 font-medium">
            <PixelIcon name="flag" className="h-4 w-4 text-primary" /> Mi carrera
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-5 py-8">
        <Ceremony phase={phase} awards={awards} compact />
      </div>
    </div>
  );
}

// "Progreso del torneo" del panel: el torneo terminado con los botones de premios.
function AdminProgress({
  rounds,
  awards,
  phase,
  onNext,
}: {
  rounds: ReturnType<typeof playTournament>["rounds"];
  awards: ReturnType<typeof computeAwards>;
  phase: Phase;
  onNext: () => void;
}) {
  const champion = awards[awards.length - 1]?.winner;
  const started = phase.kind !== "winner";
  const step =
    phase.kind === "award" ? `Premio ${phase.index + 1} de ${awards.length}: ${awards[phase.index]?.title}` : phase.kind === "intro" ? "Presentación de los premios" : phase.kind === "end" ? "Ceremonia terminada" : "Pantalla del ganador";
  const nextLabel =
    phase.kind === "intro" ? "Mostrar el primer premio" : phase.kind === "award" && phase.index + 1 < awards.length ? `Siguiente premio (${phase.index + 2}/${awards.length})` : "Terminar ceremonia";
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl space-y-5 px-5 py-8">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <PixelIcon name="flag" className="h-5 w-5 text-primary" /> Progreso del torneo
            </h2>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">Terminado</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Run It · Primera edición</p>
          <ol className="mt-4 space-y-2">
            {rounds.map((round) => {
              const advanced = round.rows.filter((r) => r.final_status === "advanced");
              const isFinal = round.capacity === 1;
              return (
                <li key={round.round_number} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                  <b>Ronda {round.round_number}</b>
                  {isFinal && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">Final · cupo 1</span>}
                  <span className="text-muted-foreground">
                    {round.rows.length} corredores → {isFinal ? `ganó ${advanced[0]?.display_name}` : `${advanced.length} clasificados`}
                  </span>
                  <span className="ml-auto rounded-full bg-success-soft px-2 py-0.5 text-xs text-success">Cerrada</span>
                </li>
              );
            })}
          </ol>
          {champion && (
            <p className="mt-4 flex items-center gap-2 text-sm">
              <PixelIcon name="trophy" className="h-4 w-4 text-[var(--gold)]" /> Ganador: <b>{champion.display_name}</b>
            </p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="flex items-center gap-2 font-semibold">
            <PixelIcon name="star" className="h-5 w-5 text-primary" /> Premios honoríficos
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Se ven en la pista y en la pantalla de cada participante. Ahora: <b className="text-foreground">{step}</b>
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={started}
              onClick={onNext}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
            >
              Iniciar premios
            </button>
            <button
              type="button"
              disabled={!started || phase.kind === "end"}
              onClick={onNext}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-40"
            >
              {nextLabel}
            </button>
          </div>
          <ol className="mt-4 grid gap-1.5 text-sm sm:grid-cols-2">
            {awards.map((award, i) => {
              const shown = phase.kind === "end" || (phase.kind === "award" && i <= phase.index);
              return (
                <li key={award.id} className={cn("flex items-center gap-2 rounded-md px-2 py-1", phase.kind === "award" && i === phase.index && "bg-primary/15")}>
                  <PixelIcon name={shown ? "check" : "star"} className={cn("h-4 w-4", shown ? "text-success" : "text-muted-foreground")} />
                  <span>{award.title}</span>
                  <span className="ml-auto truncate text-muted-foreground">{shown ? award.winner.display_name : "—"}</span>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </div>
  );
}

// Barra de la demo: no es parte de la app.
function DemoBar({
  view,
  onView,
  onRestart,
  onNext,
  onNewTournament,
}: {
  view: View;
  onView: (v: View) => void;
  onRestart: () => void;
  onNext: (() => void) | undefined;
  onNewTournament: () => void;
}) {
  const [palette, setPalette] = useState(storedPalette);
  const [sound, setSound] = useState(soundOn);
  useEffect(() => onSoundChange(() => setSound(soundOn())), []);
  const tab = (value: View, label: string) => (
    <button
      type="button"
      onClick={() => onView(value)}
      className={cn("rounded-md px-3 py-1", view === value ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 border-b-2 border-dashed border-primary bg-card px-3 py-2 text-xs">
      <b className="text-primary">Demo · ceremonia</b>
      {tab("pista", "Pista (proyector)")}
      {tab("participante", "Participante")}
      {tab("admin", "Admin")}
      <span className="ml-auto" />
      <button
        type="button"
        disabled={!onNext}
        onClick={onNext}
        className="rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground disabled:opacity-40"
      >
        Avanzar como el admin ▶
      </button>
      <button type="button" onClick={onRestart} className="rounded-md border border-border px-2 py-1 hover:bg-muted">
        Volver al ganador
      </button>
      <button type="button" onClick={onNewTournament} className="rounded-md border border-border px-2 py-1 hover:bg-muted">
        Otro torneo
      </button>
      <button type="button" onClick={() => setSoundOn(!sound)} className="rounded-md border border-border px-2 py-1 hover:bg-muted">
        Sonido: {sound ? "sí" : "no"}
      </button>
      <select
        value={palette}
        onChange={(event) => {
          setPalette(event.target.value);
          applyPalette(event.target.value);
        }}
        className="rounded-md border border-input bg-background px-1.5 py-1"
      >
        {PALETTES.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
void CAPACITIES;
