import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { TallyBars } from "@/components/hits/Grada";
import { PixelIcon } from "@/components/PixelIcon";
import { Sprite } from "@/components/Sprite";
import { confetti } from "@/lib/confetti";
import { HITS, hitInfo, type HitId, type HitPoll } from "@/lib/hits";
import { formatClock } from "@/lib/runit";
import { cn } from "@/lib/utils";

import { Score } from "../trailer/audio";
import { Director, type Scene } from "../trailer/Director";
import { OutroScene, usePortrait } from "../trailer/scenes";

import {
  BAD,
  GOOD,
  LICENSED,
  MiniSprite,
  Phone,
  PIXEL,
  pollAt,
  StreamScreen,
} from "./parts";

// Tráiler del livestream de Run It por Kick y YouTube. Otro formato que el
// tráiler del torneo: estética de transmisión de TV (barras de color, cintillo,
// "última hora", contador de espectadores) en vez del arcade synthwave.
// Cuenta qué se transmite y, sobre todo, cómo vota la grada desde el celular.

/** Música propia: otra tonalidad, otro tempo y otro gancho que el tráiler. */
const score = new Score({
  bpm: 132,
  transpose: 2,
  hook: [
    76, 0, 0, 76, 74, 0, 72, 0, 74, 0, 0, 0, 69, 0, 72, 0, 76, 0, 0, 79, 77, 0,
    76, 0, 74, 0, 72, 0, 71, 0, 0, 0,
  ],
});

/** Cuándo empieza la transmisión. */
const DATE = "Miércoles 28 de octubre";
const TIME = "11:15";

const TICKER = `Run It en vivo · ${DATE} · ${TIME} · Kick y YouTube · Torneo de programación competitiva · Vota desde tu celular · Hits buenos y malos · `;

/** Logos oficiales (static.kick.com y gstatic.com/youtube), en PNG transparente. */
function KickLogo({ className }: { className?: string }) {
  return <img src="/stream/kick.png" alt="Kick" className={cn("bc-logo-kick", className)} />;
}
function YouTubeLogo({ className }: { className?: string }) {
  return <img src="/stream/youtube.png" alt="YouTube" className={cn("bc-logo-yt", className)} />;
}

/** Milisegundos desde que se montó la escena. */
function useElapsed(stepMs = 80) {
  const [start] = useState(() => performance.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now - start;
}

/** Ancho y alto de la ventana, al día con los cambios de tamaño. */
function useViewport() {
  const read = () => [window.innerWidth, window.innerHeight] as const;
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

/**
 * Escala una pieza de tamaño fijo en px (la transmisión, el celular) hasta
 * ocupar la fracción pedida de la pantalla, sin deformarla.
 */
function Fit({
  w,
  h,
  fw,
  fh,
  className,
  children,
}: {
  w: number;
  h: number;
  fw: number;
  fh: number;
  className?: string;
  children: ReactNode;
}) {
  const [vw, vh] = useViewport();
  const k = Math.min((vw * fw) / w, (vh * fh) / h);
  return (
    <div className={cn("bc-fit", className)} style={{ width: w * k, height: h * k }}>
      <div
        style={{
          width: w,
          height: h,
          transform: `scale(${k})`,
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ── Grafismo de la transmisión: mosca, canal y cintillo ─────────────────────

const ORIGIN = performance.now();

function timecode(ms: number) {
  const frames = Math.floor((ms / 1000) * 30) % 30;
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `00:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(frames)}`;
}

function Chrome({ ticker = true }: { ticker?: boolean }) {
  useElapsed(1000 / 15);
  return (
    <div className="bc-chrome" aria-hidden="true">
      <div className="bc-bug">
        <span className="bc-rec" style={PIXEL}>
          ● En vivo
        </span>
        <span className="bc-tc">{timecode(performance.now() - ORIGIN)}</span>
      </div>
      <p className="bc-channel" style={PIXEL}>
        Run It <span>TV</span>
      </p>
      {ticker && (
        <div className="bc-ticker">
          <span className="bc-ticker-tag" style={PIXEL}>
            Vivo
          </span>
          <div className="bc-ticker-track">
            <span>
              {TICKER}
              {TICKER}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Palabras que entran de a una, con un golpecito cada una. */
function Kinetic({
  text,
  accent = [],
  className,
}: {
  text: string;
  accent?: string[];
  className?: string;
}) {
  const words = text.split(" ");
  useEffect(() => {
    const ids = words.map((_, i) =>
      setTimeout(() => score.hit("blip"), 250 + i * 120),
    );
    return () => ids.forEach(clearTimeout);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <h2 className={cn("bc-kinetic", className)}>
      {words.map((word, i) => (
        <span
          key={i}
          className={cn("bc-word", accent.includes(word) && "bc-word-accent")}
          style={{ "--i": i } as CSSProperties}
        >
          {word}{" "}
        </span>
      ))}
    </h2>
  );
}

// ── 1. Barras de color ──────────────────────────────────────────────────────

const BARS = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];
const BARS_MID = ["#0000c0", "#131313", "#c000c0", "#131313", "#00c0c0", "#131313", "#c0c0c0"];

export function BarsScene() {
  useElapsed(1000 / 15);
  return (
    <div className="bc-scene bc-bars">
      <div className="bc-bars-top">
        {BARS.map((c) => (
          <span key={c} style={{ background: c }} />
        ))}
      </div>
      <div className="bc-bars-mid">
        {BARS_MID.map((c, i) => (
          <span key={i} style={{ background: c }} />
        ))}
      </div>
      <div className="bc-bars-low">
        <span style={{ background: "#00214c" }} />
        <span style={{ background: "#fff" }} />
        <span style={{ background: "#32006a" }} />
        <span style={{ background: "#131313" }} />
        <span style={{ background: "#090909" }} />
      </div>
      <div className="bc-slate">
        <p className="bc-slate-title" style={PIXEL}>
          Run It
        </p>
        <p className="bc-slate-sub">Señal de prueba · transmisión en vivo</p>
        <p className="bc-slate-tc">{timecode(performance.now() - ORIGIN)}</p>
      </div>
      <div className="bc-static bc-static-late" />
    </div>
  );
}

// ── 2, 5. Titulares ─────────────────────────────────────────────────────────

export function NewsScene({
  tag,
  text,
  accent,
}: {
  tag: string;
  text: string;
  accent?: string[];
}) {
  return (
    <div className="bc-scene bc-news">
      <div className="bc-news-bg" aria-hidden="true" />
      <div className="bc-news-box">
        <p className="bc-news-tag" style={PIXEL}>
          {tag}
        </p>
        <Kinetic text={text} accent={accent ?? []} />
      </div>
      <Chrome />
    </div>
  );
}

// ── 3. Kick y YouTube ───────────────────────────────────────────────────────

export function PlatformsScene() {
  return (
    <div className="bc-scene bc-platforms">
      <div className="bc-plat bc-plat-kick">
        <KickLogo />
        <p className="bc-plat-live" style={PIXEL}>
          ● En vivo
        </p>
      </div>
      <p className="bc-plat-and" style={PIXEL}>
        +
      </p>
      <div className="bc-plat bc-plat-yt">
        <YouTubeLogo />
        <p className="bc-plat-live" style={PIXEL}>
          ● En vivo
        </p>
      </div>
      <p className="bc-plat-caption" style={PIXEL}>
        {DATE} · {TIME}
      </p>
      <Chrome ticker={false} />
    </div>
  );
}

// ── 4. La transmisión ───────────────────────────────────────────────────────

const RUNNERS = [
  { name: "Leo", from: 52, speed: 4.2 },
  { name: "Misa", from: 46, speed: 4.8 },
  { name: "Andy", from: 40, speed: 3.6 },
  { name: "Dani", from: 30, speed: 5.4 },
  { name: "Joselo", from: 24, speed: 3.1 },
];

const CHAT = [
  { user: "pixel_ana", text: "vamos Leo!!!" },
  { user: "byte_runner", text: "Misa ya pasó 27/30 😮" },
  { user: "elcaster_fan", text: "el caster está on fire" },
  { user: "kevin99", text: "que salga el minuto extra" },
  { user: "sof.py", text: "niebla no porfa jajaja" },
  { user: "mateo.cpp", text: "GG Dani" },
  { user: "vale_wa", text: "¿cuándo votamos?" },
  { user: "diegoAC", text: "Accepted en vivo 🔥" },
];
const CHAT_COLORS = ["#53fc18", "#ff6bd6", "#5fd4ff", "#ffd34d", "#ff8a4b"];

export function BroadcastScene() {
  const portrait = usePortrait();
  const elapsed = useElapsed(120);
  const [vw, vh] = useViewport();
  const px = Math.min(vw, vh) * (portrait ? 0.13 : 0.11);
  const viewers = Math.round(1204 + Math.min(1, elapsed / 6500) * 2667);
  const shown = CHAT.slice(0, Math.min(CHAT.length, 1 + Math.floor(elapsed / 750)));
  return (
    <div className="bc-scene bc-stream">
      <header className="bc-stream-top">
        <span className="bc-rec" style={PIXEL}>
          ● En vivo
        </span>
        <span className="bc-stream-title" style={PIXEL}>
          Run It · Ronda 3
        </span>
        <span className="bc-stream-clock" style={PIXEL}>
          {formatClock(8 * 60_000 + 52_000 - elapsed)}
        </span>
        <span className="bc-viewers">
          <PixelIcon name="users" className="h-[1em] w-[1em]" />
          {viewers.toLocaleString("es")}
        </span>
      </header>
      <section className="bc-track" aria-label="La pista">
        {RUNNERS.map((runner, i) => {
          const pct = Math.min(96, runner.from + (elapsed / 1000) * runner.speed);
          return (
            <div key={runner.name} className="bc-lane">
              <span className="bc-lane-name" style={PIXEL}>
                {i + 1} {runner.name}
              </span>
              <span className="bc-lane-runner" style={{ left: `${pct}%` }}>
                <MiniSprite index={LICENSED[i % LICENSED.length]!} px={px} />
              </span>
            </div>
          );
        })}
      </section>
      <aside className="bc-side">
        <div className="bc-cam">
          <span className="bc-cam-sprite">
            <Sprite index={LICENSED[2]!} state="idle" scale={portrait ? 1.6 : 2} />
          </span>
          <span className="bc-eq" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <i key={i} style={{ "--i": i } as CSSProperties} />
            ))}
          </span>
          <p className="bc-cam-label" style={PIXEL}>
            Caster en vivo
          </p>
        </div>
        <ul className="bc-chat" aria-label="Chat">
          {shown.map((line, i) => (
            <li key={line.user} className="bc-chat-line">
              <b style={{ color: CHAT_COLORS[i % CHAT_COLORS.length] }}>{line.user}</b>{" "}
              {line.text}
            </li>
          ))}
        </ul>
      </aside>
      <div className="bc-lower">
        <span className="bc-lower-tag" style={PIXEL}>
          En la transmisión
        </span>
        <span className="bc-lower-text">
          La pista, los envíos, las eliminaciones y la ceremonia del campeón
        </span>
      </div>
    </div>
  );
}

// ── 6. Escanear el QR ───────────────────────────────────────────────────────

export function ScanScene() {
  const portrait = usePortrait();
  const elapsed = useElapsed();
  const poll = pollAt(1, elapsed);
  return (
    <div className="bc-scene bc-duo">
      <Caption n={1} text="Escanea el QR que sale en la transmisión" />
      <div className="bc-duo-stage">
        <Fit
          w={640}
          h={400}
          fw={portrait ? 0.92 : 0.56}
          fh={portrait ? 0.3 : 0.62}
          className="bc-in-left"
        >
          <StreamScreen index={1} t={Math.min(elapsed, 3000)} poll={poll} />
        </Fit>
        <Fit
          w={250}
          h={540}
          fw={portrait ? 0.62 : 0.26}
          fh={portrait ? 0.46 : 0.72}
          className="bc-in-up"
        >
          <Phone index={0} t={elapsed - 600} poll={pollAt(0, 0)} />
        </Fit>
      </div>
      <Chrome ticker={false} />
    </div>
  );
}

// ── 7. Votar ────────────────────────────────────────────────────────────────

const SOON_MS = 2400;

export function VoteScene() {
  const portrait = usePortrait();
  const elapsed = useElapsed();
  const voting = elapsed >= SOON_MS;
  const index = voting ? 2 : 1;
  const t = voting ? Math.min(elapsed - SOON_MS, 5500) : elapsed + 1200;
  const poll = pollAt(index, t);
  return (
    <div className="bc-scene bc-vote">
      <Caption
        n={voting ? 3 : 2}
        text={
          voting
            ? "Toca el hit que quieres: 40 segundos para votar"
            : "Votación próxima: 15 segundos para ver las opciones"
        }
      />
      <div className="bc-vote-stage">
        <Callout side="left" show={elapsed > 900} icon="users" title="Sin cuenta">
          Un voto por persona, desde cualquier celular
        </Callout>
        <Fit w={250} h={540} fw={portrait ? 0.7 : 0.3} fh={portrait ? 0.6 : 0.78} className="bc-pop">
          <Phone index={index} t={t} poll={poll} />
        </Fit>
        <Callout side="right" show={elapsed > 3600} icon="zap" title="Bueno contra malo">
          {hitInfo(GOOD).name} o {hitInfo(BAD).name}: decide la grada
        </Callout>
      </div>
      <Chrome ticker={false} />
    </div>
  );
}

function Caption({ n, text }: { n: number; text: string }) {
  return (
    <div key={text} className="bc-caption">
      <span className="bc-caption-n" style={PIXEL}>
        {n}
      </span>
      <span className="bc-caption-text">{text}</span>
    </div>
  );
}

function Callout({
  side,
  show,
  icon,
  title,
  children,
}: {
  side: "left" | "right";
  show: boolean;
  icon: "users" | "zap";
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("bc-callout", `bc-callout-${side}`, show && "bc-callout-on")}>
      <PixelIcon name={icon} className="bc-callout-icon" />
      <p className="bc-callout-title" style={PIXEL}>
        {title}
      </p>
      <p className="bc-callout-text">{children}</p>
    </div>
  );
}

// ── 8. Resultado ────────────────────────────────────────────────────────────

export function ResultScene() {
  const elapsed = useElapsed();
  const poll: HitPoll = { ...pollAt(3, 0), tally: { good: 41, bad: 26 } };
  const applied = elapsed > 2200;
  useEffect(() => {
    const a = setTimeout(() => confetti({ x: 0.5, y: 0.35 }), 400);
    const b = setTimeout(() => score.hit("shimmer"), 2200);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);
  return (
    <div className="bc-scene bc-result">
      <div className="bc-news-bg" aria-hidden="true" />
      <p className="bc-result-kicker" style={PIXEL}>
        La grada eligió
      </p>
      <p className="bc-result-name" style={PIXEL}>
        {hitInfo(GOOD).name}
      </p>
      <div className="bc-result-tally vot-card">
        <TallyBars poll={poll} good={hitInfo(GOOD)} bad={hitInfo(BAD)} />
      </div>
      <div className="bc-result-clock">
        <span style={PIXEL} className={cn(applied && "bc-clock-old")}>
          08:49
        </span>
        {applied && (
          <>
            <span className="bc-clock-arrow" aria-hidden="true">
              →
            </span>
            <span style={PIXEL} className="bc-clock-new">
              09:49
            </span>
            <span style={PIXEL} className="bc-clock-plus">
              +1:00
            </span>
          </>
        )}
      </div>
      <p className="bc-result-text">Cae sobre la ronda: todos los jugadores, en vivo.</p>
      <Chrome ticker={false} />
    </div>
  );
}

// ── 9. Los hits ─────────────────────────────────────────────────────────────

const HIT_IDS = Object.keys(HITS) as HitId[];

export function HitsScene() {
  const elapsed = useElapsed(100);
  const lit = Math.floor(elapsed / 380) % HIT_IDS.length;
  return (
    <div className="bc-scene bc-hits">
      <p className="bc-hits-title" style={PIXEL}>
        Hits <span className="bc-good">buenos</span> y{" "}
        <span className="bc-bad">malos</span>
      </p>
      <div className="bc-hits-grid">
        {HIT_IDS.map((id, i) => {
          const hit = hitInfo(id);
          return (
            <div
              key={id}
              className={cn(
                "vot-option bc-hit",
                `vot-option-${hit.kind}`,
                i === lit && elapsed > 2400 && "bc-hit-lit",
              )}
              style={{ "--i": i } as CSSProperties}
            >
              <span className="bc-hit-kind" style={PIXEL}>
                Hit {hit.kind}
              </span>
              <span className="bc-hit-name" style={PIXEL}>
                {hit.name}
              </span>
              <span className="bc-hit-text">{hit.text}</span>
            </div>
          );
        })}
      </div>
      <Chrome ticker={false} />
    </div>
  );
}

// ── 10. Reglas ──────────────────────────────────────────────────────────────

const RULES = [
  { icon: "users", title: "Sin cuenta", text: "Solo escaneas el QR" },
  { icon: "clock", title: "40 segundos", text: "Después de 15 s de aviso" },
  { icon: "zap", title: "2 por ronda", text: "Nunca al inicio ni al final" },
  { icon: "flag", title: "Justo", text: "Cae sobre todos por igual" },
] as const;
const RULE_MS = 1350;

export function RulesScene() {
  const elapsed = useElapsed(60);
  const i = Math.min(RULES.length - 1, Math.floor(elapsed / RULE_MS));
  const rule = RULES[i]!;
  useEffect(() => {
    score.hit("impact");
  }, [i]);
  return (
    <div className={cn("bc-scene bc-rule", `bc-rule-${i}`)}>
      <div key={i} className="bc-rule-slab">
        <PixelIcon name={rule.icon} className="bc-rule-icon" />
        <p className="bc-rule-title" style={PIXEL}>
          {rule.title}
        </p>
        <p className="bc-rule-text">{rule.text}</p>
      </div>
      <ol className="bc-rule-dots" aria-hidden="true">
        {RULES.map((r, n) => (
          <li key={r.title} className={cn(n <= i && "bc-rule-dot-on")} />
        ))}
      </ol>
      <Chrome ticker={false} />
    </div>
  );
}

// ── 11. Muy pronto ──────────────────────────────────────────────────────────

export function SoonScene() {
  return (
    <div className="bc-scene bc-soon">
      <div className="bc-static" aria-hidden="true" />
      <p className="bc-soon-title" data-text="Muy pronto" style={PIXEL}>
        Muy pronto
      </p>
      <p className="bc-soon-sub" style={PIXEL}>
        Run It en vivo
      </p>
      <p className="bc-soon-when" style={PIXEL}>
        <span>{DATE}</span>
        <b>{TIME}</b>
      </p>
      <div className="bc-soon-chips">
        <span className="bc-chip">
          <KickLogo />
        </span>
        <span className="bc-chip">
          <YouTubeLogo />
        </span>
      </div>
      <p className="bc-soon-date">El torneo completo, en vivo en los dos canales</p>
      <Chrome />
    </div>
  );
}

// ── El guion ────────────────────────────────────────────────────────────────

const SCENES: Scene[] = [
  {
    id: "barras",
    label: "Señal",
    ms: 3600,
    cut: "boot",
    section: "intro",
    render: () => <BarsScene />,
  },
  {
    id: "titular",
    label: "En vivo",
    ms: 4200,
    cut: "glitch",
    section: "build",
    render: () => (
      <NewsScene
        tag="Última hora"
        text="Run It se transmite en vivo"
        accent={["en", "vivo"]}
      />
    ),
  },
  {
    id: "canales",
    label: "Kick y YouTube",
    ms: 5000,
    cut: "flash",
    section: "full",
    render: () => <PlatformsScene />,
  },
  {
    id: "transmision",
    label: "La transmisión",
    ms: 8000,
    cut: "flash",
    section: "full",
    render: () => <BroadcastScene />,
  },
  {
    id: "decides",
    label: "Tú decides",
    ms: 3800,
    cut: "glitch",
    section: "build",
    render: () => (
      <NewsScene
        tag="Voto del público"
        text="Y tú decides qué le pasa a la ronda"
        accent={["tú", "decides"]}
      />
    ),
  },
  {
    id: "qr",
    label: "Escanea",
    ms: 5600,
    cut: "flash",
    section: "build",
    render: () => <ScanScene />,
  },
  {
    id: "votar",
    label: "Vota",
    ms: 8400,
    cut: "flash",
    section: "full",
    render: () => <VoteScene />,
  },
  {
    id: "resultado",
    label: "Resultado",
    ms: 5600,
    cut: "white",
    section: "triumph",
    render: () => <ResultScene />,
  },
  {
    id: "hits",
    label: "Los hits",
    ms: 6400,
    cut: "glitch",
    section: "full",
    render: () => <HitsScene />,
  },
  {
    id: "reglas",
    label: "Reglas",
    ms: RULE_MS * RULES.length + 400,
    cut: "flash",
    section: "build",
    render: () => <RulesScene />,
  },
  {
    id: "pronto",
    label: "Muy pronto",
    ms: 5200,
    cut: "glitch",
    section: "full",
    render: () => <SoonScene />,
  },
  {
    id: "logos",
    label: "Logos",
    ms: 7000,
    cut: "white",
    section: "outro",
    render: () => (
      <OutroScene
        title="Run It en vivo"
        credits="Personajes: Tiny Heroes de CraftPix.net · Tipografías: Press Start 2P y Pixelify Sans (OFL) · Música original"
      />
    ),
  },
];

export function StreamTrailer() {
  return <Director scenes={SCENES} score={score} eyebrow="Run It en vivo · tráiler" />;
}
