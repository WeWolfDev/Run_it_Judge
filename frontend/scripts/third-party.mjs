// Arma src/lib/third-party.json: dependencias directas del frontend y del
// backend con su versión, licencia y repositorio, para la sección de licencias
// de /legal/creditos. Correr con `npm run licenses` al agregar o quitar una.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

function collect(dir) {
  const pkg = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
  return Object.keys(pkg.dependencies ?? {}).map((name) => {
    const file = join(root, dir, "node_modules", name, "package.json");
    if (!existsSync(file)) return { name, version: "?", license: "?", url: null };
    const dep = JSON.parse(readFileSync(file, "utf8"));
    const repo = typeof dep.repository === "string" ? dep.repository : dep.repository?.url;
    const url =
      dep.homepage ??
      (repo
        ? repo
            .replace(/^git\+/, "")
            .replace(/\.git$/, "")
            .replace(/^git:/, "https:")
        : null);
    const license = typeof dep.license === "string" ? dep.license : (dep.license?.type ?? "?");
    return { name, version: dep.version, license, url };
  });
}

const out = {
  frontend: collect("frontend"),
  backend: collect("run-it-backend"),
};
writeFileSync(
  join(here, "..", "src", "lib", "third-party.json"),
  JSON.stringify(out, null, 2) + "\n",
);
console.log(`frontend ${out.frontend.length} · backend ${out.backend.length}`);
