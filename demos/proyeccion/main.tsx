import "@/styles.css";
import "./proyeccion.css";

const { createRoot } = await import("react-dom/client");
const { useEffect, useState, useSyncExternalStore } = await import("react");
const { PALETTES, applyPalette, storedPalette } = await import("../shell/DemoShell");
const { createSim } = await import("./sim");
const { ProjectedTrack } = await import("./ProjectedTrack");
applyPalette(storedPalette());

type Sim = ReturnType<typeof createSim>;
const SIZES = [12, 36, 60];
// Cupo de la demo: un tercio de los corredores, como en una eliminatoria.
const capacityFor = (participants: number) => Math.max(3, Math.round(participants / 3));

function App() {
  const [size, setSize] = useState(36);
  const [speed, setSpeed] = useState(1);
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
    // Solo al cambiar de simulación.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim]);
  // Cada cambio de la simulación vuelve a dibujar (el ranking es un arreglo nuevo).
  const version = useSyncExternalStore(
    (listener) => sim.subscribe(listener),
    () => `${sim.events()[0]?.id ?? 0}-${sim.round().closed}`,
  );
  void version;
  return (
    <>
      <ProjectedTrack round={{ ...sim.round() }} board={sim.board()} events={sim.events()} />
      <Controls
        size={size}
        speed={speed}
        closed={sim.round().closed}
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
  size: number;
  speed: number;
  closed: boolean;
  onSize: (n: number) => void;
  onSpeed: (n: number) => void;
  onClose: () => void;
  onRestart: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(storedPalette);
  return (
    <aside className="fixed bottom-3 right-3 z-[70] w-64 rounded-lg border-2 border-dashed border-primary bg-card/95 p-2 text-xs text-foreground shadow-xl">
      <div className="flex items-center justify-between">
        <b className="text-primary">Simulación (demo)</b>
        <button type="button" className="text-muted-foreground" onClick={() => setOpen(!open)}>
          {open ? "Ocultar" : "Mostrar"}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="flex flex-wrap items-center gap-1">
            Corredores:
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
              Cerrar ronda
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
