import { TOTAL_POINTS } from "./content";

// Rangos por XP, de gris a rojo (gris, verde, cian, azul, violeta, naranja y
// rojo). El nombre acompaña siempre al color: el rango nunca se lee solo por el
// color.

export type Tier = { min: number; name: string; color: string };

export const TIERS: Tier[] = [
  { min: 0, name: "Novato", color: "#a3a3a3" },
  { min: 40, name: "Aprendiz", color: "#84cc16" },
  { min: 100, name: "Especialista", color: "#22d3ee" },
  { min: 180, name: "Experto", color: "#6d8bff" },
  { min: 260, name: "Candidato a Maestro", color: "#e879f9" },
  { min: 360, name: "Maestro", color: "#fb923c" },
  // Todo el mapa disponible resuelto.
  { min: TOTAL_POINTS, name: "Gran Maestro", color: "#f43f5e" },
];

export function tierOf(points: number) {
  let tier = TIERS[0]!;
  for (const t of TIERS) if (points >= t.min) tier = t;
  return tier;
}

export function nextTier(points: number) {
  return TIERS.find((t) => t.min > points) ?? null;
}
