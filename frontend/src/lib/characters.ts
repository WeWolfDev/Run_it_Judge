// todos los personajes de frontend/Run_it_Asset 3 más los GIF de public/.
// El índice en CHARACTERS es el número de personaje que se guarda (session.ts,
// participants.character). Cada uno define sus animaciones como filas de una
// hoja de sprites: idle (quieto), run (corriendo hacia la derecha) y out
// (derrota, se reproduce una vez). Los GIF traen su animación adentro.

export type SpriteAnim = {
  sheet: string;
  row: number;
  frames: number;
  fps: number;
  col0?: number;
  once?: boolean;
  /** Cuadro en el que se queda al terminar (la derrota de Tiny Heroes termina en polvo). */
  hold?: number;
};

export type CharacterDef = {
  name: string;
  title: string;
  pack: string;
  /** Tamaño de un cuadro en la hoja. */
  fw: number;
  fh: number;
  /** Escala entera para que el pixel art se vea nítido. */
  scale: number;
  anims?: { idle: SpriteAnim; run: SpriteAnim; out?: SpriteAnim };
  gif?: { idle: string; run: string; width: number; height: number; scale: number };
};

const A = (
  sheet: string,
  row: number,
  frames: number,
  fps: number,
  extra: Partial<SpriteAnim> = {},
): SpriteAnim => ({
  sheet: `/chars/${sheet}`,
  row,
  frames,
  fps,
  ...extra,
});

const animals: CharacterDef[] = (
  [
    ["Gato naranja", "El curioso", "CATSPRITESHEET_Orange.png"],
    ["Gato gris", "El sigiloso", "CATSPRITESHEET_Gray.png"],
    ["Zorro", "El astuto", "FOXSPRITESHEET.png"],
    ["Pájaro blanco", "El ligero", "BIRDSPRITESHEET_White.png"],
    ["Pájaro azul", "El veloz", "BIRDSPRITESHEET_Blue.png"],
    ["Mapache", "El ingenioso", "RACCOONSPRITESHEET.png"],
  ] as const
).map(([name, title, sheet]) => ({
  name,
  title,
  pack: "Animales",
  fw: 32,
  fh: 32,
  scale: 4,
  // Filas según las etiquetas de Animals WIP.aseprite: "Run R" = filas 9 y 10.
  anims: { idle: A(sheet, 0, 4, 5), run: A(sheet, 9, 8, 12) },
}));

const tiny: CharacterDef[] = (
  [
    ["Monstruo Rosa", "La traviesa", "Pink"],
    ["Búho", "El sabio", "Owlet"],
    ["Dude", "El tranquilo", "Dude"],
  ] as const
).map(([name, title, key]) => ({
  name,
  title,
  pack: "Tiny Heroes",
  fw: 32,
  fh: 32,
  scale: 4,
  anims: {
    idle: A(`${key}_Monster_Idle_4.png`, 0, 4, 6),
    run: A(`${key}_Monster_Run_6.png`, 0, 6, 12),
    out: A(`${key}_Monster_Death_8.png`, 0, 3, 8, { once: true }),
  },
}));

// [nombre, título, hoja, fila de derrota, cuadros de derrota]
const villagers: CharacterDef[] = (
  [
    ["Aldeana", "La madrugadora", "MiniVillagerWoman", 4, 4],
    ["Aldeano", "El trabajador", "MiniVillagerMan", 4, 4],
    ["Noble", "El elegante", "MiniNobleMan", 4, 4],
    ["Noble (mujer)", "La distinguida", "MiniNobleWoman", 4, 4],
    ["Reina", "La soberana", "MiniQueen", 4, 5],
    ["Princesa", "La valiente", "MiniPrincess", 4, 5],
    ["Anciano", "El experimentado", "MiniOldMan", 4, 3],
    ["Anciana", "La paciente", "MiniOldWoman", 4, 4],
    ["Campesino", "El constante", "MiniPeasant", 5, 4],
    ["Obrero", "El incansable", "MiniWorker", 6, 4],
  ] as const
).map(([name, title, sheet, deathRow, deathFrames]) => ({
  name,
  title,
  pack: "Aldeanos",
  fw: 32,
  fh: 32,
  scale: 4,
  anims: {
    idle: A(`${sheet}.png`, 0, 4, 5),
    run: A(`${sheet}.png`, 1, 6, 11),
    out: A(`${sheet}.png`, deathRow, deathFrames, 8, { once: true }),
  },
}));

// [nombre, título, hoja, cuadros quieto, fila correr, fila derrota, cuadros derrota]
const humans: CharacterDef[] = (
  [
    ["Jinete", "El galopante", "MiniHorseMan", 8, 1, 6, 6],
    ["Caballero", "El noble jinete", "MiniCavalierMan", 8, 1, 6, 6],
    ["Rey", "El estratega", "MiniKingMan", 4, 2, 6, 6],
    ["Príncipe", "El heredero", "MiniPrinceMan", 4, 1, 5, 6],
    ["Espadachín", "El preciso", "MiniSwordMan", 4, 1, 5, 4],
    ["Escudero", "El resistente", "MiniShieldMan", 4, 1, 6, 4],
    ["Lancero", "El certero", "MiniSpearMan", 4, 1, 5, 5],
    ["Alabardero", "El firme", "MiniHalberdMan", 4, 1, 5, 5],
    ["Arquero", "El paciente", "MiniArcherMan", 4, 1, 6, 4],
    ["Ballestero", "El calculador", "MiniCrossBowMan", 4, 1, 6, 4],
    ["Mago", "El ingenioso", "MiniMage", 4, 1, 7, 9],
    ["Archimago", "El maestro", "MiniArchMage", 4, 1, 8, 9],
  ] as const
).map(([name, title, sheet, idleFrames, runRow, deathRow, deathFrames]) => ({
  name,
  title,
  pack: "Humanos",
  fw: 32,
  fh: 32,
  scale: 4,
  anims: {
    idle: A(`${sheet}.png`, 0, idleFrames, 6),
    run: A(`${sheet}.png`, runRow, 6, 11),
    out: A(`${sheet}.png`, deathRow, deathFrames, 9, { once: true }),
  },
}));

const npcNames = [
  "Leo",
  "Mia",
  "Tomás",
  "Ana",
  "Hugo",
  "Lucía",
  "Sofía",
  "Iker",
  "Vale",
  "Bruno",
  "Emma",
  "Mateo",
];
const npcs: CharacterDef[] = npcNames.map((name, i) => ({
  name,
  title: "Programador",
  pack: "NPC",
  fw: 64,
  fh: 64,
  scale: 2,
  // Fila 0: quieto de frente; fila 7: caminando hacia la derecha.
  anims: { idle: A(`npc${i + 1}.png`, 0, 4, 4), run: A(`npc${i + 1}.png`, 7, 4, 9) },
}));

const others: CharacterDef[] = [
  {
    name: "Pixel",
    title: "El veloz",
    pack: "Clásicos",
    fw: 33,
    fh: 33,
    scale: 4,
    // Arte de 33 px ampliado 7 veces en el GIF: se muestra a 33 × 4 = 132 px.
    gif: {
      idle: "/character-white.gif",
      run: "/character-white.gif",
      width: 33,
      height: 33,
      scale: 4,
    },
  },
  {
    name: "Aurora",
    title: "La veloz",
    pack: "Clásicos",
    fw: 33,
    fh: 33,
    scale: 4,
    gif: {
      idle: "/character-blue.gif",
      run: "/character-blue.gif",
      width: 33,
      height: 33,
      scale: 4,
    },
  },
  {
    name: "Explorador",
    title: "El salvaje",
    pack: "Clásicos",
    fw: 21,
    fh: 34,
    scale: 4,
    gif: {
      idle: "/chars/jungle_idle.gif",
      run: "/chars/jungle_run.gif",
      width: 21,
      height: 34,
      scale: 4,
    },
  },
  {
    name: "Explorador (contorno)",
    title: "El aventurero",
    pack: "Clásicos",
    fw: 23,
    fh: 35,
    scale: 4,
    gif: {
      idle: "/chars/jungle_idle_o.gif",
      run: "/chars/jungle_run_o.gif",
      width: 23,
      height: 35,
      scale: 4,
    },
  },
  {
    name: "Figura",
    title: "La misteriosa",
    pack: "Clásicos",
    fw: 24,
    fh: 24,
    scale: 5,
    anims: {
      idle: A("AnimationSheet.png", 0, 1, 1),
      run: A("AnimationSheet.png", 2, 8, 12),
      out: A("AnimationSheet.png", 4, 2, 4, { once: true, col0: 6 }),
    },
  },
];

export const CHARACTERS: CharacterDef[] = [
  ...others,
  ...animals,
  ...tiny,
  ...villagers,
  ...humans,
  ...npcs,
];

export const CHARACTER_PACKS = [...new Set(CHARACTERS.map((c) => c.pack))];

export function characterAt(index: number) {
  return CHARACTERS[index] ?? CHARACTERS[0]!;
}
