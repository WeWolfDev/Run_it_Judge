import type { UserRole } from "@/lib/session";

export type LoginMode = "participant" | "caster";

export function minimumLoginCodeLength(mode: LoginMode) {
  return mode === "caster" ? 8 : 6;
}

export function loginModeError(role: UserRole, mode: LoginMode) {
  if (mode === "caster" && role !== "caster") {
    return "Esta cuenta no es de caster. Usa la opción de participante.";
  }
  if (mode === "participant" && role === "caster") {
    return "Esta cuenta es de caster. Usa la opción de caster.";
  }
  return null;
}
