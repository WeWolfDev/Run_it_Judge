// DEMO: cursor pixel art (flecha y mano) dibujado con los colores de la paleta.
// X = borde, O = relleno (primario), H = brillo (acento). Cada celda son 2×2 px.
const ARROW = [
  "X..........", "XX.........", "XHX........", "XHOX.......", "XHOOX......", "XHOOOX.....", "XHOOOOX....", "XHOOOOOX...",
  "XHOOOOOOX..", "XHOOOOOOOX.", "XHOOOOXXXXX", "XHOXOOX....", "XOX.XOOX...", "XX..XOOX...", "X....XOOX..", ".....XXX...",
];
const HAND = [
  "....XX..........", "...XHOX.........", "...XHOX.........", "...XHOX.........", "...XHOXXX.......", "...XHOXOOXXX....",
  "...XHOXOOXOOXX..", "XX.XHOXOOXOOXOX.", "XHXXHOOOOOOOXOX.", "XHOXOOOOOOOOOOX.", ".XOOOOOOOOOOOOX.", "..XOOOOOOOOOOOX.",
  "..XOOOOOOOOOOX..", "...XOOOOOOOOOX..", "....XOOOOOOOX...", "....XXXXXXXXX...",
];

function draw(map: string[], colors: Record<string, string>) {
  const canvas = document.createElement("canvas");
  canvas.width = map[0]!.length * 2;
  canvas.height = map.length * 2;
  const context = canvas.getContext("2d")!;
  map.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const color = colors[ch];
      if (!color) return;
      context.fillStyle = color;
      context.fillRect(x * 2, y * 2, 2, 2);
    }),
  );
  return canvas.toDataURL("image/png");
}

export function applyPixelCursor() {
  const style = getComputedStyle(document.documentElement);
  const colors = {
    X: "#0b0613",
    O: style.getPropertyValue("--primary").trim() || "#3cc4d9",
    H: style.getPropertyValue("--accent").trim() || "#ffffff",
  };
  const root = document.documentElement;
  root.style.setProperty("--cur-default", `url(${draw(ARROW, colors)}) 0 0, auto`);
  root.style.setProperty("--cur-pointer", `url(${draw(HAND, colors)}) 9 1, pointer`);
  root.classList.add("pixel-cursor");
}
