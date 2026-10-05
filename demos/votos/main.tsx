import "@/styles.css";
import "../proyeccion/proyeccion.css";
import "./votos.css";

const { createRoot } = await import("react-dom/client");
const { useEffect, useState, useSyncExternalStore } = await import("react");
const { PALETTES, applyPalette, storedPalette } = await import("../shell/DemoShell");
const { createSim } = await import("../proyeccion/sim");
const { ProjectedTrack } = await import("../proyeccion/ProjectedTrack");
const { createGame } = await import("./game");
const { Admin, Blackout, GradaCard, Participant, Phone } = await import("./screens");
const { formatLeft } = await import("./hits");
applyPalette(storedPalette());

// DEMO: voto del público. Una ronda simulada y cuatro pantallas sincronizadas:
// la proyección (con el QR), el celular de la grada, el participante y el admin.

type Screen = "proyeccion" | "celular" | "participante" | "admin";
const SCREENS: Array<[Screen, string]> = [
  ["proyeccion", "Proyección"],
  ["celular", "Celular (QR)"],
  ["participante", "Participante"],
  ["admin", "Admin"],
];
/** El participante que se muestra en su vista. */
const ME = "p3";

function boot() {
  const sim = createSim({ participants: 36, capacity: 12 });
  return { sim, game: createGame(sim) };
}

function App() {
  const [{ sim, game }, setWorld] = useState(boot);
  const [screen, setScreen] = useState<Screen>("proyeccion");
  const [speed, setSpeed] = useState(1);
  useEffect(() => () => {
    sim.stop();
    game.stop();
  }, [sim, game]);
  useSyncExternalStore(
    (l) => sim.subscribe(l),
    () => `${sim.events()[0]?.id ?? 0}-${sim.round().closed}-${sim.round().capacity}-${sim.round().endsAt}`,
  );
  useSyncExternalStore(
    (l) => game.subscribe(l),
    () => `${game.polls().length}-${game.poll()?.votes.good}-${game.poll()?.votes.bad}-${game.poll()?.winner}-${game.active().length}-${game.poll()?.mine}-${game.announcing()}`,
  );
  const round = { ...sim.round() };
  const board = sim.board();
  const restart = () => {
    const next = boot();
    next.sim.setSpeed(speed);
    setWorld(next);
  };

  return (
    <>
      {screen === "proyeccion" && (
        <>
          <ProjectedTrack
            round={round}
            board={board}
            events={sim.events()}
            fog={game.isOn("niebla") ? `Niebla · el ranking vuelve en ${formatLeft(game.left("niebla"))}` : null}
            clockHidden={game.isOn("reloj-oculto")}
          />
          <GradaCard game={game} />
          <Blackout game={game} />
        </>
      )}
      {screen === "celular" && <Phone game={game} round={round} />}
      {screen === "participante" && <Participant game={game} round={round} board={board} me={ME} />}
      {screen === "admin" && <Admin game={game} round={round} />}
      <Controls
        screen={screen}
        onScreen={setScreen}
        speed={speed}
        onSpeed={(n) => {
          setSpeed(n);
          sim.setSpeed(n);
        }}
        elapsed={Math.max(0, Date.now() - round.startsAt) * speed}
        onRestart={restart}
      />
    </>
  );
}

const btn = "rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-muted disabled:opacity-40";

// Panel de la demo: no es parte de la app.
function Controls(props: {
  screen: Screen;
  onScreen: (s: Screen) => void;
  speed: number;
  onSpeed: (n: number) => void;
  elapsed: number;
  onRestart: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [palette, setPalette] = useState(storedPalette);
  return (
    <aside className="fixed bottom-3 left-3 z-[70] w-72 rounded-lg border-2 border-dashed border-primary bg-card/95 p-2 text-xs text-foreground shadow-xl">
      <div className="flex items-center justify-between">
        <b className="text-primary">Voto del público (demo)</b>
        <button type="button" className="text-muted-foreground" onClick={() => setOpen(!open)}>
          {open ? "Ocultar" : "Mostrar"}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-1">
            {SCREENS.map(([id, label]) => (
              <button key={id} type="button" className={btn} disabled={props.screen === id} onClick={() => props.onScreen(id)}>
                {label}
              </button>
            ))}
          </div>
          <p className="flex flex-wrap items-center gap-1">
            Velocidad:
            {[1, 3].map((n) => (
              <button key={n} type="button" className={btn} disabled={n === props.speed} onClick={() => props.onSpeed(n)}>
                ×{n}
              </button>
            ))}
            <span className="ml-auto text-muted-foreground">ronda {formatLeft(props.elapsed)}</span>
          </p>
          <p className="text-muted-foreground">
            Anuncia la votación en Admin (desde el minuto 1): 15 s de aviso y 40 s para votar. Vota en Celular y mira el hit en Proyección y Participante.
          </p>
          <p className="flex gap-1">
            <button type="button" className={btn} onClick={props.onRestart}>
              Reiniciar ronda
            </button>
          </p>
          <select
            value={palette}
            onChange={(event) => {
              setPalette(event.target.value);
              applyPalette(event.target.value);
            }}
            className="w-full rounded-md border border-input bg-background px-1.5 py-1"
          >
            {PALETTES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </aside>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
