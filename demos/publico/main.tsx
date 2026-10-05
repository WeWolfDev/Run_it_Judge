import "@/styles.css";
import "../proyeccion/proyeccion.css";
import "./publico.css";

const { createRoot } = await import("react-dom/client");
const { useCallback, useEffect, useState, useSyncExternalStore } = await import("react");
const { PALETTES, applyPalette, storedPalette } = await import("../shell/DemoShell");
const { createSim } = await import("../proyeccion/sim");
const { ProjectedTrack } = await import("../proyeccion/ProjectedTrack");
const { Intro } = await import("./shared");
const { TOWER, TowerView } = await import("./Tower");
const { BALLOONS, BalloonsView } = await import("./Balloons");
const { SOCCER, SoccerView } = await import("./Soccer");
const { BOAT, BoatView } = await import("./Boat");
applyPalette(storedPalette());

// DEMO: vistas del público (/publico). Misma ronda, cinco formas de verla: a
// cada espectador le toca una al azar. No cambia nada de lo que juegan los
// participantes; solo cambia el dibujo.

type Sim = ReturnType<typeof createSim>;
const TRACK = {
  id: "pista",
  name: "La pista",
  rule: "La carrera de siempre: cada test resuelto es un tramo de pista. Clasifican los primeros en llegar a la meta.",
  goal: "llegó a la meta",
  ending: "terminó la carrera",
};
const VIEWS = [TRACK, TOWER, BALLOONS, SOCCER, BOAT];
const VIEW_KEY = "runit-publico-vista";

// Al azar, sin repetir la última que vio este espectador.
function pickView(exclude?: string) {
  let last = exclude;
  try {
    last ??= localStorage.getItem(VIEW_KEY) ?? undefined;
  } catch {
    // Sin almacenamiento: cualquiera vale.
  }
  const options = VIEWS.filter((v) => v.id !== last);
  const view = options[Math.floor(Math.random() * options.length)]!;
  try {
    localStorage.setItem(VIEW_KEY, view.id);
  } catch {
    // Sin almacenamiento: se sortea igual.
  }
  return view;
}

const SIZES = [12, 36, 60];
const capacityFor = (participants: number) => Math.max(3, Math.round(participants / 3));

function App() {
  const [size, setSize] = useState(36);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState(() => pickView());
  const [intro, setIntro] = useState(true);
  const [sim, setSim] = useState<Sim>(() => createSim({ participants: 36, capacity: capacityFor(36) }));
  const restart = (participants = size) => {
    sim.stop();
    const next = createSim({ participants, capacity: capacityFor(participants) });
    next.setSpeed(speed);
    setSim(next);
  };
  useEffect(() => {
    sim.setSpeed(speed);
    return () => sim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim]);
  const version = useSyncExternalStore(
    (listener) => sim.subscribe(listener),
    () => `${sim.events()[0]?.id ?? 0}-${sim.round().closed}`,
  );
  void version;
  const endIntro = useCallback(() => setIntro(false), []);
  const props = { round: { ...sim.round() }, board: sim.board(), events: sim.events() };
  const choose = (id: string) => {
    setView(VIEWS.find((v) => v.id === id)!);
    setIntro(true);
  };

  return (
    <>
      {view.id === "pista" && <ProjectedTrack {...props} />}
      {view.id === "torre" && <TowerView {...props} />}
      {view.id === "globos" && <BalloonsView {...props} />}
      {view.id === "futbol" && <SoccerView {...props} />}
      {view.id === "bote" && <BoatView {...props} />}
      {intro && <Intro key={view.id} view={view} onDone={endIntro} />}
      <Controls
        view={view.id}
        size={size}
        speed={speed}
        closed={sim.round().closed}
        onView={choose}
        onShuffle={() => {
          setView(pickView(view.id));
          setIntro(true);
        }}
        onSize={(n) => {
          setSize(n);
          restart(n);
        }}
        onSpeed={(n) => {
          setSpeed(n);
          sim.setSpeed(n);
        }}
        onClose={() => sim.close()}
        onRestart={() => restart()}
      />
    </>
  );
}

const btn = "rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-muted disabled:opacity-40";

// Panel de la demo: no es parte de la app.
function Controls(props: {
  view: string;
  size: number;
  speed: number;
  closed: boolean;
  onView: (id: string) => void;
  onShuffle: () => void;
  onSize: (n: number) => void;
  onSpeed: (n: number) => void;
  onClose: () => void;
  onRestart: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [palette, setPalette] = useState(storedPalette);
  return (
    <aside className="fixed bottom-3 left-3 z-[70] w-64 rounded-lg border-2 border-dashed border-primary bg-card/95 p-2 text-xs text-foreground shadow-xl">
      <div className="flex items-center justify-between">
        <b className="text-primary">Vistas del público (demo)</b>
        <button type="button" className="text-muted-foreground" onClick={() => setOpen(!open)}>
          {open ? "Ocultar" : "Mostrar"}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-[1fr_auto] gap-1">
            <select value={props.view} onChange={(e) => props.onView(e.target.value)} className="rounded-md border border-input bg-background px-1.5 py-1">
              {VIEWS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <button type="button" className={btn} onClick={props.onShuffle}>
              Sortear
            </button>
          </div>
          <p className="flex flex-wrap items-center gap-1">
            Jugadores:
            {SIZES.map((n) => (
              <button key={n} type="button" className={btn} disabled={n === props.size} onClick={() => props.onSize(n)}>
                {n}
              </button>
            ))}
          </p>
          <p className="flex flex-wrap items-center gap-1">
            Velocidad:
            {[1, 3, 8].map((n) => (
              <button key={n} type="button" className={btn} disabled={n === props.speed} onClick={() => props.onSpeed(n)}>
                ×{n}
              </button>
            ))}
          </p>
          <p className="flex flex-wrap gap-1">
            <button type="button" className={btn} disabled={props.closed} onClick={props.onClose}>
              Terminar ronda
            </button>
            <button type="button" className={btn} onClick={props.onRestart}>
              Reiniciar
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
