// confeti cuadrado (pixel) en un canvas a pantalla completa. Usa los
// colores de los silks para que combine con la pista.
export function confetti(origin?: { x: number; y: number }) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  canvas.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999";
  document.body.appendChild(canvas);
  const context = canvas.getContext("2d")!;
  const style = getComputedStyle(document.documentElement);
  const colors = Array.from(
    { length: 10 },
    (_, i) => style.getPropertyValue(`--silk-${i}`).trim() || "#fff",
  );
  const ox = (origin?.x ?? 0.5) * innerWidth;
  const oy = (origin?.y ?? 0.4) * innerHeight;
  const parts = Array.from({ length: 140 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 9;
    return {
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 6,
      size: 4 + Math.floor(Math.random() * 3) * 2,
      color: colors[Math.floor(Math.random() * colors.length)]!,
    };
  });
  const start = performance.now();
  const frame = (now: number) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    parts.forEach((p) => {
      p.vy += 0.35;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      context.fillStyle = p.color;
      context.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    });
    if (now - start < 2600) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
