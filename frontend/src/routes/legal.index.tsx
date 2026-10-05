import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/legal/")({
  beforeLoad: () => {
    throw redirect({ to: "/legal/privacidad" });
  },
});
