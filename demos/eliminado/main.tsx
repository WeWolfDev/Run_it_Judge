import "@/styles.css";
import "./eliminado.css";

const { createRoot } = await import("react-dom/client");
const { useState } = await import("react");
const { PALETTES, applyPalette, storedPalette } = await import("../shell/DemoShell");
const { PixelIcon } = await import("@/components/PixelIcon");
const { CHARACTERS } = await import("@/lib/characters");
const { onSoundChange, setSoundOn, soundOn } = await import("@/lib/sfx");
const { Eliminated } = await import("./Eliminated");
applyPalette(storedPalette());

// DEMO: la pantalla del participante cuando la ronda cierra y no clasificó.
function App() {
  const [run, setRun] = useState(0);
  const [character, setCharacter] = useState(26);
  const [exited, setExited] = useState<"" | "login" | "pista">("");
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <DemoBar
        character={character}
        onCharacter={(c) => {
          setCharacter(c);
          setExited("");
          setRun((r) => r + 1);
        }}
        onReplay={() => {
          setExited("");
          setRun((r) => r + 1);
        }}
      />
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
      <main className="mx-auto max-w-4xl px-5 py-8">
        {exited ? (
          <div className="rounded-xl border-2 border-dashed border-primary bg-card p-6 text-center text-sm">
            {exited === "login"
              ? "En la app: se cierra la sesión y vuelve a /login."
              : "En la app: abre /pista para seguir mirando la carrera (y después la ceremonia)."}
            <button type="button" className="ml-3 underline" onClick={() => { setExited(""); setRun((r) => r + 1); }}>
              Repetir
            </button>
          </div>
        ) : (
          <Eliminated
            key={run}
            name="Lima"
            character={character}
            roundNumber={2}
            rank={7}
            total={12}
            capacity={4}
            passed={4}
            tests={5}
            fails={2}
            onExit={() => setExited("login")}
            onSpectate={() => setExited("pista")}
          />
        )}
      </main>
    </div>
  );
}

// Barra de la demo: no es parte de la app.
function DemoBar({ character, onCharacter, onReplay }: { character: number; onCharacter: (c: number) => void; onReplay: () => void }) {
  const [palette, setPalette] = useState(storedPalette);
  const [sound, setSound] = useState(soundOn);
  useState(() => onSoundChange(() => setSound(soundOn())));
  return (
    <div className="flex flex-wrap items-center gap-2 border-b-2 border-dashed border-primary bg-card px-3 py-2 text-xs">
      <b className="text-primary">Demo · eliminado</b>
      <button type="button" onClick={onReplay} className="rounded-md bg-primary px-3 py-1 font-medium text-primary-foreground">
        Repetir animación
      </button>
      <label className="flex items-center gap-1">
        Personaje
        <select value={character} onChange={(e) => onCharacter(Number(e.target.value))} className="rounded-md border border-input bg-background px-1.5 py-1">
          {CHARACTERS.map((c, i) => (
            <option key={i} value={i}>
              {c.name} · {c.pack}
            </option>
          ))}
        </select>
      </label>
      <span className="ml-auto" />
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
