// Reglas del apodo del modo solo. El servidor tiene la última palabra (trigger
// en perfiles, deploy/supabase/004_solo_perfil_y_moderacion.sql, con sus listas
// en tablas); esta copia solo avisa antes de enviar. Al cambiar una lista,
// cambiar las dos.

/** Formato: lo mismo que el check de perfiles.apodo. */
export const NICKNAME = /^[A-Za-z0-9_-]{3,20}$/;

/**
 * Raíces prohibidas, ya normalizadas (minúsculas, sin acentos, sin letras
 * repetidas): groserías, insultos, contenido sexual, odio y violencia.
 */
const BLOCKED = [
  "puta",
  "puto",
  "pendej",
  "chinga",
  "verga",
  "culer",
  "culo",
  "mierda",
  "cabron",
  "joto",
  "marica",
  "pinche",
  "mamon",
  "mamada",
  "panocha",
  "naco",
  "pija",
  "cagar",
  "cagad",
  "estupid",
  "idiota",
  "imbecil",
  "sexo",
  "porno",
  "porn",
  "pene",
  "violad",
  "violacion",
  "pedofil",
  "pederast",
  "nazi",
  "hitler",
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "pusy",
  "whore",
  "slut",
  "dick",
  "niga",
  "niger",
  "fagot",
  "retard",
];

/** Palabras normales que contienen una raíz prohibida: se quitan antes de buscar. */
const ALLOWED = [
  "computa",
  "computo",
  "disputa",
  "reputa",
  "imputa",
  "diputa",
  "calcul",
  "articul",
  "vehicul",
  "ridicul",
  "curricul",
  "matricul",
  "cubicul",
  "penetr",
  "pijama",
];

/** No se puede hacer pasar por el equipo. */
const RESERVED = ["admin", "moderador", "soporte", "wewolf", "runit", "oficial"];

/**
 * Minúsculas, números como letras (0→o, 1→i o l, 3→e, 4→a, 5→s, 7→t, 8→b, 9→g),
 * sin guiones y sin letras repetidas ("puuuta" → "puta").
 */
export function normalize(apodo: string, one: "i" | "l") {
  const map: Record<string, string> = {
    "0": "o",
    "1": one,
    "3": "e",
    "4": "a",
    "5": "s",
    "7": "t",
    "8": "b",
    "9": "g",
  };
  return apodo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[0-9]/g, (d) => map[d] ?? "")
    .replace(/[^a-z]/g, "")
    .replace(/(.)\1+/g, "$1");
}

function contains(apodo: string, words: string[]) {
  return (["i", "l"] as const).some((one) => {
    let text = normalize(apodo, one);
    for (const ok of ALLOWED) text = text.replaceAll(ok, "");
    return words.some((word) => text.includes(word));
  });
}

/** Por qué no se acepta el apodo, o null si está bien. */
export function nicknameProblem(apodo: string): string | null {
  if (!NICKNAME.test(apodo)) {
    return "Usa de 3 a 20 letras sin acentos, números, guion o guion bajo.";
  }
  if (contains(apodo, BLOCKED)) {
    return "Ese apodo no está permitido: no se aceptan groserías, insultos ni contenido ofensivo.";
  }
  if (contains(apodo, RESERVED)) {
    return "Ese apodo parece del equipo de Run It. Elige otro.";
  }
  return null;
}
