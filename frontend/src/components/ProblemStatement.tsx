import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

// Único lugar donde se configura el render del enunciado.
// Sin rehype-raw a propósito: react-markdown descarta el HTML crudo y un
// <script> o un onerror del enunciado se muestran como texto, no se ejecutan.

type MdNode = { type: string; value?: string; children?: MdNode[] };

// Markdown ignora los saltos de línea simples. Este plugin los convierte en
// <br> para que el enunciado se vea como lo escribió el organizador. Solo toca
// nodos de texto: las fórmulas y el código guardan su contenido en `value`.
function remarkLineBreaks() {
  const walk = (node: MdNode) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child) => {
      if (child.type !== "text" || !child.value?.includes("\n")) {
        walk(child);
        return [child];
      }
      return child.value.split(/\r?\n/).flatMap((line, index) => {
        const text: MdNode = { type: "text", value: line };
        return index === 0 ? [text] : [{ type: "break" }, text];
      });
    });
  };
  return walk;
}

export function ProblemStatement({ statement }: { statement: string }) {
  return (
    <div className="run-it-statement mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
      <ReactMarkdown remarkPlugins={[remarkMath, remarkLineBreaks]} rehypePlugins={[rehypeKatex]}>
        {statement}
      </ReactMarkdown>
    </div>
  );
}
