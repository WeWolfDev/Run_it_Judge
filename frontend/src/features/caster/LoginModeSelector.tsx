import { cn } from "@/lib/utils";

import type { LoginMode } from "./login";

const PIXEL = { fontFamily: "'Press Start 2P', ui-monospace, monospace" };

export function LoginModeSelector({
  mode,
  onChange,
}: {
  mode: LoginMode;
  onChange: (mode: LoginMode) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(["participant", "caster"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={mode === option}
          onClick={() => onChange(option)}
          className={cn(
            "border px-2 py-2 text-[9px] transition-colors",
            mode === option
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
          style={PIXEL}
        >
          {option === "caster" ? "Caster" : "Participante"}
        </button>
      ))}
    </div>
  );
}
