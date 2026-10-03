import { useEffect, useRef, useState } from "react";
import type * as Monaco from "monaco-editor/editor/editor.api";

type EditorLanguage = "python" | "c" | "cpp";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: EditorLanguage;
  /** Se muestra con el editor vacío; nunca pasa a ser su valor. */
  placeholder?: string;
  readOnly: boolean;
  /** Ctrl/Cmd + Enter. */
  onRunShortcut?: () => void;
}

// Monaco en escritorio y textarea como respaldo: mientras Monaco carga, si no
// carga, o en pantallas táctiles, donde Monaco maneja mal el teclado virtual.
export function CodeEditor({
  value,
  onChange,
  language,
  placeholder = "",
  readOnly,
  onRunShortcut,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [ready, setReady] = useState(false);
  // Los callbacks cambian en cada render; el editor se crea una sola vez.
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRunShortcut);
  onChangeRef.current = onChange;
  onRunRef.current = onRunShortcut;
  const initial = useRef({ value, language, placeholder, readOnly });

  useEffect(() => {
    if (import.meta.env.SSR) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    let disposed = false;
    let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
    void import("@/lib/monaco")
      .then(({ monaco, defineRunItTheme }) => {
        if (disposed || !containerRef.current) return;
        const start = initial.current;
        editor = monaco.editor.create(containerRef.current, {
          value: start.value,
          language: start.language,
          placeholder: start.placeholder,
          readOnly: start.readOnly,
          theme: defineRunItTheme(),
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 14,
          fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
          tabSize: 4,
          insertSpaces: true,
          renderLineHighlight: "line",
          padding: { top: 12, bottom: 12 },
          // Sin sugerencias de palabras: en un torneo no hay autocompletado.
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          wordBasedSuggestions: "off",
          parameterHints: { enabled: false },
        });
        editor.onDidChangeModelContent(() => {
          onChangeRef.current(editor?.getValue() ?? "");
        });
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current?.());
        editorRef.current = editor;
        setReady(true);
      })
      .catch(() => {
        // Sin Monaco queda el textarea: el participante puede seguir escribiendo.
      });
    return () => {
      disposed = true;
      editor?.getModel()?.dispose();
      editor?.dispose();
      editorRef.current = null;
    };
  }, []);

  // Valor que llega de afuera (por ejemplo, la plantilla al cambiar de lenguaje):
  // solo si difiere, para no mover el cursor en cada tecla. La indentación se
  // vuelve a detectar: la plantilla de Python usa 2 espacios y las de C/C++ 4.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.getValue() === value) return;
    editor.setValue(value);
    editor.getModel()?.detectIndentation(true, 4);
  }, [value]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    void import("@/lib/monaco").then(({ monaco }) =>
      monaco.editor.setModelLanguage(model, language),
    );
  }, [language, ready]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly, placeholder });
  }, [readOnly, placeholder, ready]);

  return (
    <div className="relative h-96">
      <div
        ref={containerRef}
        className={`absolute inset-0 ${ready ? "" : "invisible"} ${readOnly ? "opacity-60" : ""}`}
        aria-hidden={!ready}
      />
      {!ready && (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              onRunShortcut?.();
            }
          }}
          placeholder={placeholder}
          spellCheck={false}
          disabled={readOnly}
          aria-label="Editor de código"
          className="absolute inset-0 h-full w-full resize-none bg-editor px-4 py-3 font-mono text-sm text-editor-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
      )}
    </div>
  );
}

export default CodeEditor;
