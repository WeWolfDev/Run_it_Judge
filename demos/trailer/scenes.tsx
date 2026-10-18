import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { ArcadeDeck } from "@/components/ArcadeDeck";
import { Ceremony } from "@/components/Ceremony";
import { LoginBackdrop } from "@/components/LoginBackdrop";
import { PixelIcon } from "@/components/PixelIcon";
import { Feed, ProjectedTrack, Quota, Track } from "@/components/ProjectedTrack";
import { Sprite } from "@/components/Sprite";
import { useArcadeDeck } from "@/hooks/use-arcade-deck";
import type { Ceremony as CeremonyData, CeremonyAward } from "@/lib/api";
import { confetti } from "@/lib/confetti";
import { characterAt } from "@/lib/characters";
import { formatClock, verdictLabel } from "@/lib/runit";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";

import { score } from "./audio";

import { boardOf, characterOf, createRace, stepRace, type Race } from "./sim";

// Escenas del tráiler. Cada una arranca al montarse y dura lo que el director
// (Trailer.tsx) le da; las de la app son los componentes reales de Run It.

const PIXEL: CSSProperties = {
  fontFamily: "'Press Start 2P', ui-monospace, monospace",
};

/** Pantalla vertical (celular): la pista y las pantallas de código cambian de composición. */
export function usePortrait() {
  const query = "(max-aspect-ratio: 1/1)";
  const [portrait, setPortrait] = useState(
    () => window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setPortrait(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return portrait;
}

/** Re-render periódico: las escenas animan por tiempo transcurrido. */
function useElapsed(stepMs = 100) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now - start;
}

// ── Fondo de los títulos ─────────────────────────────────────────────────────

/** Fondo de arcade: cielo con estrellas, piso de grilla en perspectiva y barrido CRT. */
function Arcade({
  children,
  runners = false,
}: {
  children: ReactNode;
  runners?: boolean;
}) {
  return (
    <div className="tr-arcade">
      <div className="tr-stars" aria-hidden="true" />
      <div className="tr-sun" aria-hidden="true" />
      <div className="tr-floor" aria-hidden="true" />
      {runners && (
        <div className="tr-runners" aria-hidden="true">
          {["Leo", "Misa", "Andy", "Joselo", "Dani"].map((name, i) => (
            <span
              key={name}
              className="tr-runner"
              style={{ "--i": i } as CSSProperties}
            >
              <Sprite index={characterOf(name)} state="run" scale={1.1} />
            </span>
          ))}
        </div>
      )}
      <div className="login-scanlines pointer-events-none absolute inset-0" />
      <div className="run-it-crt-sweep" />
      <div className="tr-vignette" aria-hidden="true" />
      <div className="tr-title-stage">{children}</div>
    </div>
  );
}

/** Frase en tipografía cinética: cada palabra entra con su retardo. */
function Words(props: {
  text: string;
  accent?: string[];
  size?: "md" | "lg" | "xl";
}) {
  // Un "blip" por palabra, al ritmo en que entran (mismo retardo que el CSS).
  const count = props.text.split(" ").length;
  useEffect(() => {
    const timers = Array.from({ length: count }, (_, i) =>
      setTimeout(() => score.hit("blip"), 150 + i * 130),
    );
    return () => timers.forEach(clearTimeout);
  }, [count]);
  return <WordsText {...props} />;
}

function WordsText({
  text,
  accent = [],
  size = "md",
}: {
  text: string;
  accent?: string[];
  size?: "md" | "lg" | "xl";
}) {
  return (
    <p className={cn("tr-words", `tr-words-${size}`)}>
      {text.split(" ").map((word, i) => (
        <span
          key={i}
          className={cn("tr-word", accent.includes(word) && "tr-word-accent")}
          style={{ "--i": i } as CSSProperties}
        >
          {word}
        </span>
      ))}
    </p>
  );
}

// ── 1. Bienvenidos ───────────────────────────────────────────────────────────

export function IntroScene() {
  return (
    <Arcade runners>
      <p className="tr-kicker">Bienvenidos a</p>
      <h1 className="tr-logo" data-text="RUN IT" style={PIXEL}>
        RUN IT
      </h1>
      <p className="tr-under" style={PIXEL}>
        ▶ press start
      </p>
    </Arcade>
  );
}

// ── Títulos sueltos ──────────────────────────────────────────────────────────

export function TitleScene({
  text,
  accent,
  size = "lg",
  sub,
}: {
  text: string;
  accent?: string[];
  size?: "md" | "lg" | "xl";
  sub?: string;
}) {
  return (
    <Arcade>
      <Words text={text} accent={accent ?? []} size={size} />
      {sub && (
        <p className="tr-sub" style={PIXEL}>
          {sub}
        </p>
      )}
    </Arcade>
  );
}

// ── 3. La pista con 20 jugadores ─────────────────────────────────────────────

export function TrackScene() {
  const race = useRef<Race | null>(null);
  race.current ??= createRace(Date.now());
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      if (race.current) stepRace(race.current, Date.now());
      tick((n) => n + 1);
    }, 260);
    return () => clearInterval(id);
  }, []);
  const r = race.current;
  const portrait = usePortrait();
  return (
    <div className="tr-track">
      {portrait ? (
        <PortraitTrack race={r} />
      ) : (
        <div className="tr-camera">
          <ProjectedTrack
            round={r.round}
            board={boardOf(r)}
            events={r.events}
          />
        </div>
      )}
      <div className="tr-lower-third tr-lower-third-brief">
        <span className="tr-lt-tag" style={PIXEL}>
          En vivo
        </span>
        <span className="tr-lt-text">
          Ronda 3 · <b>20 jugadores</b> · clasifican 8
        </span>
      </div>
    </div>
  );
}

/**
 * La pista en vertical, con las mismas piezas que la de /pista (carriles,
 * medallas, meta a cuadros, corte, cupo y feed), apiladas para el celular.
 */
function PortraitTrack({ race }: { race: Race }) {
  const board = boardOf(race);
  const solved = board.filter((entry) => entry.solved_at).length;
  const now = Date.now();
  const left = Math.max(0, race.round.endsAt - now);
  const latest = race.events[0];
  const announce =
    latest?.kind === "solved" && now - latest.at < 2600 ? latest : null;
  return (
    <div className="tr-pt proj">
      <header className="tr-pt-head">
        <div className="min-w-0">
          <p className="tr-pt-brand proj-logo" style={PIXEL}>
            Run It
          </p>
          <p className="tr-pt-kicker">Ronda {race.round.number}</p>
          <p className="tr-pt-round">{race.round.problem}</p>
        </div>
        <div className="tr-pt-time">
          <span className="tr-pt-live" style={PIXEL}>
            En curso
          </span>
          <p className="tr-pt-kicker">Tiempo</p>
          <p className="tr-pt-clock" style={PIXEL}>
            {formatClock(left)}
          </p>
        </div>
      </header>
      <div className="tr-pt-track">
        <Track
          lanes={board.slice(0, 10)}
          capacity={race.round.capacity}
          closed={false}
          total={board.length}
        />
      </div>
      <div className="tr-pt-side">
        <Quota
          solved={solved}
          capacity={race.round.capacity}
          participants={board.length}
        />
        <Feed events={race.events.slice(0, 3)} />
      </div>
      {announce && (
        <div key={announce.id} className="tr-pt-announce animate-run-it-pop">
          <MiniSprite name={announce.name} vmin={16} />
          <p style={PIXEL}>¡{announce.name} clasifica!</p>
        </div>
      )}
    </div>
  );
}

// ── 5. Varias pantallas de participantes programando ────────────────────────

type Screen = {
  name: string;
  language: string;
  file: string;
  code: string;
  verdict: string;
  passed: number;
  /** Cuándo termina de escribir y envía (ms desde el inicio de la escena). */
  sendAt: number;
};

const SCREENS: Screen[] = [
  {
    name: "Leo",
    language: "C++",
    file: "solution.cpp",
    verdict: "accepted",
    passed: 30,
    sendAt: 7600,
    code: `#include <bits/stdc++.h>
using namespace std;

int main() {
    long long x;
    cin >> x;
    cout << (x + 4) / 5 << "\\n"; // ✔
}`,
  },
  {
    name: "Misa",
    language: "Python 3",
    file: "solution.py",
    verdict: "Wrong Answer",
    passed: 13,
    sendAt: 4300,
    code: `x = int(input())
# pasos de 5
print(x // 5)`,
  },
  {
    name: "Joselo",
    language: "C",
    file: "solution.c",
    verdict: "Time Limit Exceeded",
    passed: 21,
    sendAt: 5400,
    code: `#include <stdio.h>

int main(void) {
    long long x, pasos = 0;
    scanf("%lld", &x);
    while (x > 0) {
        x -= 1;
        pasos++;
    }
    printf("%lld\\n", pasos);
}`,
  },
  {
    name: "Andy",
    language: "C++",
    file: "solution.cpp",
    verdict: "Compilation Error",
    passed: 0,
    sendAt: 6200,
    code: `#include <bits/stdc++.h>
using namespace std;

int main() {
    int x
    cin >> x;
    cout << (x + 4) / 5;
}`,
  },
];

/** Resaltado mínimo: comentarios, cadenas, números y palabras clave. */
function highlight(line: string) {
  const comment = line.search(/\/\/|#(?!include)/);
  const code = comment === -1 ? line : line.slice(0, comment);
  const rest = comment === -1 ? "" : line.slice(comment);
  const parts: ReactNode[] = [];
  let last = 0;
  const re =
    /("[^"]*"|\b\d+\b|#include|<[a-z/.+]+>|\b(?:int|long|void|return|while|for|if|else|using|namespace|def|print|input|import|main|cin|cout|scanf|printf)\b)/g;
  for (const match of code.matchAll(re)) {
    const i = match.index ?? 0;
    if (i > last) parts.push(code.slice(last, i));
    const token = match[0];
    const cls =
      token.startsWith('"') || token.startsWith("<")
        ? "tr-tok-str"
        : /^\d/.test(token)
          ? "tr-tok-num"
          : "tr-tok-kw";
    parts.push(
      <span key={i} className={cls}>
        {token}
      </span>,
    );
    last = i + token.length;
  }
  if (last < code.length) parts.push(code.slice(last));
  if (rest)
    parts.push(
      <span key="c" className="tr-tok-com">
        {rest}
      </span>,
    );
  return parts;
}

/** Sprite a tamaño real achicado con transform hasta entrar en la casilla. */
function MiniSprite({ name, vmin }: { name: string; vmin: number }) {
  const character = characterAt(characterOf(name));
  const width = character.gif ? character.gif.width : character.fw;
  const height = character.gif ? character.gif.height : character.fh;
  const box = (vmin * Math.min(window.innerWidth, window.innerHeight)) / 100;
  return (
    <span className="tr-mini" style={{ width: box, height: box }}>
      <span
        className="tr-mini-inner"
        style={{
          width,
          height,
          transform: `translateX(-50%) scale(${(box / Math.max(height, width * 0.8)) * 1.25})`,
        }}
      >
        <Sprite index={characterOf(name)} state="run" scale={0.01} />
      </span>
    </span>
  );
}

function CodingScreen({
  screen,
  elapsed,
  index,
}: {
  screen: Screen;
  elapsed: number;
  index: number;
}) {
  const typeStart = 600 + index * 250;
  const typed = Math.max(
    0,
    Math.min(1, (elapsed - typeStart) / (screen.sendAt - typeStart)),
  );
  const visible = screen.code.slice(0, Math.floor(screen.code.length * typed));
  const sending = elapsed >= screen.sendAt && elapsed < screen.sendAt + 900;
  const judged = elapsed >= screen.sendAt + 900;
  const accepted = screen.verdict === "accepted";
  const fired = useRef(false);
  useEffect(() => {
    if (!judged || fired.current) return;
    fired.current = true;
    // Los mismos efectos de la app (ZzFX): aceptado o fallo.
    play(accepted ? "win" : "error");
    if (accepted) confetti({ x: 0.27, y: 0.3 });
  }, [judged, accepted]);
  const clock = 4 * 60_000 + 37_000 - elapsed;
  const progress = judged ? screen.passed / 30 : 0.2 + typed * 0.25;
  const lines = visible.split("\n");
  return (
    <div
      className={cn(
        "tr-screen",
        judged && (accepted ? "tr-screen-ac" : "tr-screen-fail"),
      )}
      style={{ "--i": index } as CSSProperties}
    >
      <div className="tr-screen-top">
        <MiniSprite name={screen.name} vmin={5} />
        <div className="min-w-0">
          <p className="tr-screen-name">{screen.name}</p>
          <p className="tr-screen-meta">Ronda 3 · cupo 8 · {screen.language}</p>
        </div>
        <p
          className={cn(
            "tr-screen-clock",
            clock < 4 * 60_000 + 33_000 && "tr-clock-tick",
          )}
        >
          <PixelIcon name="clock" className="h-[1.4vmin] w-[1.4vmin]" />
          {formatClock(clock)}
        </p>
      </div>
      <div className="tr-screen-lane" aria-hidden="true">
        <span
          className="tr-screen-runner"
          style={{ left: `calc(${progress * 100}% - ${progress * 2.4}vmin)` }}
        >
          <MiniSprite name={screen.name} vmin={3.4} />
        </span>
        <PixelIcon name="flag" className="tr-screen-flag" />
      </div>
      <div className="tr-editor">
        <p className="tr-editor-tab">
          <i aria-hidden="true" /> {screen.file}
        </p>
        <pre className="tr-code">
          {lines.map((line, i) => (
            <span key={i} className="tr-code-line">
              <span className="tr-ln">{i + 1}</span>
              <span>
                {highlight(line)}
                {i === lines.length - 1 && !judged && (
                  <span className="tr-caret" />
                )}
              </span>
            </span>
          ))}
        </pre>
      </div>
      <div className="tr-screen-bottom">
        {!sending && !judged && (
          <span className="tr-screen-status">Escribiendo…</span>
        )}
        {sending && (
          <span className="tr-screen-status">
            <span className="run-it-spinner" aria-hidden="true">
              {Array.from({ length: 9 }, (_, i) => (
                <i key={i} />
              ))}
            </span>
            Corriendo 30 casos…
          </span>
        )}
        {judged && (
          <span
            className={cn(
              "tr-verdict",
              accepted ? "tr-verdict-ac" : "tr-verdict-fail",
            )}
          >
            {accepted ? "¡Clasificado!" : verdictLabel(screen.verdict)} ·{" "}
            {screen.passed}/30
          </span>
        )}
      </div>
    </div>
  );
}

export function CodingScene() {
  const elapsed = useElapsed(60);
  return (
    <div className="tr-coding">
      <div className={cn("tr-grid", elapsed > 9600 && "tr-grid-focus")}>
        {SCREENS.map((screen, index) => (
          <CodingScreen
            key={screen.name}
            screen={screen}
            elapsed={elapsed}
            index={index}
          />
        ))}
      </div>
      <div className="tr-lower-third">
        <span className="tr-lt-tag" style={PIXEL}>
          Contrarreloj
        </span>
        <span className="tr-lt-text">
          Cada envío corre contra 30 casos ocultos
        </span>
      </div>
    </div>
  );
}

// ── 7. El campeón ────────────────────────────────────────────────────────────

const TOURNAMENT = { id: "copa-wewolf", name: "Copa WeWolf" };
const CHAMPION = {
  participant_id: "p0",
  display_name: "Leo",
  character: characterOf("Leo"),
};

export function WinnerScene() {
  const ceremony: CeremonyData = {
    tournament: TOURNAMENT,
    step: null,
    updated_at: null,
    champion: CHAMPION,
    awards: [],
  };
  return (
    <div className="tr-full">
      <Ceremony ceremony={ceremony} />
    </div>
  );
}

// ── 9. Premios especiales ────────────────────────────────────────────────────

const winner = (name: string) => ({
  participant_id: name,
  display_name: name,
  character: characterOf(name),
});

/** Premios reales del torneo (run-it-backend/awards.js) con ganadores de ejemplo. */
const AWARDS: CeremonyAward[] = [
  {
    id: "rayo",
    title: "El Rayo del AC",
    description: "El primer Accepted del torneo: el globo verde inicial.",
    winner: winner("Maricarmen"),
    detail: "Accepted en la ronda 1, a los 3:12",
  },
  {
    id: "matagigantes",
    title: "El Matagigantes",
    description:
      "El jugador revelación que dejó afuera a uno de los grandes favoritos.",
    winner: winner("Andy"),
    detail: "Eliminó al favorito en la ronda 2",
  },
  {
    id: "o1",
    title: "Compilador O(1) Humano",
    description: "La solución más rápida en los servidores del juez.",
    winner: winner("Misa"),
    detail: "12 ms en el caso más grande",
  },
];

export const AWARD_MS = 4600;

export function AwardsScene() {
  const elapsed = useElapsed(200);
  const index = Math.min(AWARDS.length - 1, Math.floor(elapsed / AWARD_MS));
  const [updatedAt, setUpdatedAt] = useState(() => new Date().toISOString());
  useEffect(() => setUpdatedAt(new Date().toISOString()), [index]);
  const ceremony: CeremonyData = {
    tournament: TOURNAMENT,
    step: index + 1,
    updated_at: updatedAt,
    champion: CHAMPION,
    awards: AWARDS,
  };
  return (
    <div className="tr-full">
      <Ceremony key={index} ceremony={ceremony} />
      <div className="tr-gifts" aria-hidden="true">
        <span style={PIXEL}>+ regalos</span>
        <PixelIcon name="star" className="h-[2.4vmin] w-[2.4vmin]" />
        <PixelIcon name="heart" className="h-[2.4vmin] w-[2.4vmin]" />
        <PixelIcon name="trophy" className="h-[2.4vmin] w-[2.4vmin]" />
      </div>
    </div>
  );
}

// ── 12. La pantalla del evento ───────────────────────────────────────────────

export function EventScene() {
  const deck = useArcadeDeck();
  const elapsed = useElapsed(80);
  const name = "Leo".slice(0, Math.max(0, Math.floor((elapsed - 900) / 220)));
  const code = "••••••".slice(
    0,
    Math.max(0, Math.floor((elapsed - 1900) / 160)),
  );
  const pressed = elapsed > 3600;
  const pulse = useRef(deck.pulse);
  pulse.current = deck.pulse;
  useEffect(() => {
    const id = setInterval(
      () => pulse.current(Math.random() < 0.5 ? "left" : "right"),
      240,
    );
    const stop = setTimeout(() => clearInterval(id), 3400);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, []);
  return (
    <main className="login-cabinet tr-full flex flex-col overflow-hidden text-foreground">
      <div className="login-bezel flex flex-1 p-[1.6vmin] lg:px-[4vmin] lg:pt-[3vmin]">
        <section className="login-screen relative flex flex-1 items-center justify-center overflow-hidden">
          <div className="login-glass pointer-events-none absolute inset-0">
            <LoginBackdrop id="arcade" />
            <div className="absolute inset-0 bg-black/35" />
            <div className="login-scanlines absolute inset-0" />
            <div className="run-it-crt-sweep" />
            <div className="login-vignette absolute inset-0" />
          </div>
          <div className="relative z-10 flex w-full flex-col items-center gap-[2.4vmin] px-4">
            <h1
              className="login-title tr-event-title text-center text-[9vmin] text-primary"
              style={PIXEL}
            >
              Run It
            </h1>
            <div className="tr-event-box w-[min(46vmin,90%)] space-y-[1.2vmin] border-2 border-primary bg-card/85 p-[2vmin] shadow-[6px_6px_0_0_var(--primary)] backdrop-blur-sm">
              <p
                className="text-center text-[1.3vmin] text-accent"
                style={PIXEL}
              >
                Login
              </p>
              <p className="login-field tr-fake-field">
                {name || <span className="opacity-50">Nombre de usuario</span>}
              </p>
              <p className="login-field tr-fake-field">
                {code || <span className="opacity-50">Código de acceso</span>}
              </p>
              <p
                className={cn(
                  "login-start w-full bg-primary py-[1.2vmin] text-center text-[1.4vmin] text-primary-foreground",
                  pressed && "tr-pressed",
                )}
                style={PIXEL}
              >
                Press start
              </p>
            </div>
            <p className="tr-event-cta" style={PIXEL}>
              Inscríbete · {TOURNAMENT.name}
            </p>
          </div>
        </section>
      </div>
      <ArcadeDeck stick={deck.stick} pressed={deck.pressed} />
    </main>
  );
}

// ── 13. Salida con los logos ─────────────────────────────────────────────────

const CREDITS =
  "Personajes: Tiny Heroes de CraftPix.net · Fondos: ansimuz (CC0) · Pista: Kenney (CC0) · Música original";

export function OutroScene({
  title = "Run It",
  credits = CREDITS,
}: {
  title?: string;
  credits?: string;
}) {
  return (
    <div className="tr-outro">
      <div className="tr-outro-logos">
        <img src="/trailer/cpc.png" alt="CPC" className="tr-outro-logo" />
        <span className="tr-outro-x" aria-hidden="true">
          ×
        </span>
        <img
          src="/trailer/wewolf.png"
          alt="WeWolf"
          className="tr-outro-logo tr-outro-logo-2"
        />
      </div>
      <p className="tr-outro-run" style={PIXEL}>
        {title}
      </p>
      <p className="tr-outro-credits">{credits}</p>
      <div className="tr-outro-fade" aria-hidden="true" />
    </div>
  );
}
