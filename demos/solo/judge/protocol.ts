// Tipos compartidos entre la página y los workers del juez de la demo.

/** Salida máxima por caso (como el límite de archivo de Judge0). */
export const OUTPUT_LIMIT = 16 * 1024 * 1024;

/** Resultado de correr un caso. `verdict` es "ok" o el veredicto de Judge0 que corresponda. */
export type CaseRun = {
  verdict: string;
  stdout: string;
  stderr: string;
  ms: number;
};
