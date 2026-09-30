import { createFileRoute } from "@tanstack/react-router";
import ParticipantView from "@/components/ParticipantView";

export const Route = createFileRoute("/preview")({
  head: () => ({
    meta: [
      { title: "Preview — Run It" },
      {
        name: "description",
        content: "Vista previa de la pantalla de participantes sin login.",
      },
    ],
  }),
  component: PreviewPage,
});

function PreviewPage() {
  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <ParticipantView />
    </div>
  );
}
