// DEMO: hits del voto del público. Reglas: un hit nunca toca el editor, el
// enunciado ni el veredicto; cae sobre todos por igual ("por regla, no por
// nombre"); cada votación enfrenta un bueno contra un malo del mismo peso.

export type HitId =
  | "extra"
  | "amnistia"
  | "cupo-mas"
  | "pista"
  | "aliento"
  | "penal-doble"
  | "reloj-oculto"
  | "apagon"
  | "niebla"
  | "cupo-menos";

export type Hit = {
  id: HitId;
  kind: "bueno" | "malo";
  name: string;
  /** Lo que lee el público en el celular. */
  text: string;
  /** Duración en ms de ronda; 0 = instantáneo (se aplica y queda). */
  duration: number;
  /** A quién afecta, para el admin. */
  scope: string;
};

export const HITS: Record<HitId, Hit> = {
  extra: {
    id: "extra",
    kind: "bueno",
    name: "Minuto extra",
    text: "Suma 1 minuto al reloj de la ronda para todos.",
    duration: 0,
    scope: "Reloj de la ronda",
  },
  amnistia: {
    id: "amnistia",
    kind: "bueno",
    name: "Amnistía",
    text: "Durante 1:30 los envíos fallidos no suman penalización.",
    duration: 90_000,
    scope: "Penalización de todos",
  },
  "cupo-mas": {
    id: "cupo-mas",
    kind: "bueno",
    name: "Cupo +1",
    text: "Clasifica uno más en esta ronda.",
    duration: 0,
    scope: "Cupo de la ronda",
  },
  pista: {
    id: "pista",
    kind: "bueno",
    name: "Pista del organizador",
    text: "Los participantes reciben una pista del problema.",
    duration: 0,
    scope: "Aviso en la vista del participante",
  },
  aliento: {
    id: "aliento",
    kind: "bueno",
    name: "Aliento de la grada",
    text: "Confeti y un mensaje de la grada en cada pantalla.",
    duration: 10_000,
    scope: "Cosmético",
  },
  "penal-doble": {
    id: "penal-doble",
    kind: "malo",
    name: "Penalización doble",
    text: "Durante 2 minutos cada envío fallido cuesta +60 s en vez de +30 s.",
    duration: 120_000,
    scope: "Penalización de todos",
  },
  "reloj-oculto": {
    id: "reloj-oculto",
    kind: "malo",
    name: "Reloj oculto",
    text: "El cronómetro desaparece durante 60 s.",
    duration: 60_000,
    scope: "Pista y vista del participante",
  },
  apagon: {
    id: "apagon",
    kind: "malo",
    name: "Apagón",
    text: "La pista proyectada se apaga durante 45 s.",
    duration: 45_000,
    scope: "Solo la pantalla del público",
  },
  niebla: {
    id: "niebla",
    kind: "malo",
    name: "Niebla",
    text: "Oculta el ranking a todos durante 75 s.",
    duration: 75_000,
    scope: "Pista y ranking del participante",
  },
  "cupo-menos": {
    id: "cupo-menos",
    kind: "malo",
    name: "Cupo −1",
    text: "Clasifica uno menos en esta ronda.",
    duration: 0,
    scope: "Cupo de la ronda",
  },
};

/** Pares de la votación: un bueno contra un malo del mismo peso. */
export const PAIRS: Array<{ weight: 1 | 2 | 3; good: HitId; bad: HitId }> = [
  { weight: 2, good: "extra", bad: "niebla" },
  { weight: 2, good: "amnistia", bad: "penal-doble" },
  { weight: 3, good: "cupo-mas", bad: "cupo-menos" },
  { weight: 1, good: "pista", bad: "reloj-oculto" },
  { weight: 1, good: "aliento", bad: "apagon" },
];

/** Votaciones por ronda: 2 como máximo, 1 recomendada. */
export const MAX_POLLS = 2;
export const POLL_MS = 40_000;
/** Aviso previo: "Votación próxima" antes de abrir, para que la grada saque el celular. */
export const ANNOUNCE_MS = 15_000;
/** Ventanas sin votación: el primer minuto y los últimos 2 de la ronda. */
export const QUIET_START_MS = 60_000;
export const QUIET_END_MS = 120_000;

export const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };

export function formatLeft(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
