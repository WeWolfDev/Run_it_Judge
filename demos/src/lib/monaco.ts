// Monaco solo existe en el navegador: este módulo se importa con import()
// dinámico desde CodeEditor, nunca en el render del servidor. Se carga la API
// del editor sin el bundle completo: solo Python y C/C++ (la gramática de cpp
// registra "c" y "cpp") y el worker base, sin los de TypeScript, CSS o HTML.
import * as monaco from "monaco-editor/editor/editor.api";
// editor.api es solo el núcleo: sin estos módulos no hay íconos, buscar,
// plegado, comentar con Ctrl+/, multicursor ni el texto del placeholder.
// Sin sugerencias ni snippets: en un torneo no hay autocompletado.
import "monaco-editor/features/codicon/register";
import "monaco-editor/features/placeholderText/register";
import "monaco-editor/features/readOnlyMessage/register";
import "monaco-editor/features/bracketMatching/register";
import "monaco-editor/features/caretOperations/register";
import "monaco-editor/features/clipboard/register";
import "monaco-editor/features/comment/register";
import "monaco-editor/features/contextmenu/register";
import "monaco-editor/features/cursorUndo/register";
import "monaco-editor/features/find/register";
import "monaco-editor/features/folding/register";
import "monaco-editor/features/gotoLine/register";
import "monaco-editor/features/indentation/register";
import "monaco-editor/features/lineSelection/register";
import "monaco-editor/features/linesOperations/register";
import "monaco-editor/features/multicursor/register";
import "monaco-editor/features/smartSelect/register";
import "monaco-editor/features/wordHighlighter/register";
import "monaco-editor/features/wordOperations/register";
import "monaco-editor/features/wordPartOperations/register";
import "monaco-editor/languages/definitions/python/register";
import "monaco-editor/languages/definitions/cpp/register";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

// Monaco no entiende variables CSS ni oklch: el color se resuelve con un canvas
// de 1 px, que el navegador convierte a sRGB.
function cssColor(variable: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  if (!value) return fallback;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return fallback;
  context.fillStyle = fallback;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

// Tema a partir de las variables --editor-* de styles.css, para que el editor
// combine con el resto del panel.
export function defineRunItTheme() {
  const background = cssColor("--editor", "#1b1d2a");
  const foreground = cssColor("--editor-foreground", "#e6e9f2");
  const muted = cssColor("--editor-muted", "#8b93a7");
  const border = cssColor("--editor-border", "#2c3042");
  const primary = cssColor("--primary", "#3cc4d9");
  monaco.editor.defineTheme("run-it", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": background,
      "editor.foreground": foreground,
      "editorLineNumber.foreground": muted,
      "editorLineNumber.activeForeground": foreground,
      "editorCursor.foreground": primary,
      "editor.lineHighlightBackground": `${border}80`,
      "editorIndentGuide.background1": border,
      "editorWidget.background": background,
      "editorWidget.border": border,
      "editor.selectionBackground": `${primary}40`,
      "scrollbarSlider.background": `${muted}33`,
    },
  });
  return "run-it";
}

export { monaco };
