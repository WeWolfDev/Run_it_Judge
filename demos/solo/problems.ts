// Ejercicios de la demo solo, con enunciados propios (los formatos de entrada y
// salida siguen los problemas de Codeforces anotados en `source`). Sus 30 casos (los de los .zip de RunIt-demo-tests) están
// en public/solo-tests/<id>.json y se descargan al enviar. No se le pide nada al
// servidor del torneo.

export type Language = "python" | "c" | "cpp";

export const LANGUAGES: Record<Language, { label: string; file: string }> = {
  python: { label: "Python 3", file: "solution.py" },
  c: { label: "C", file: "solution.c" },
  cpp: { label: "C++", file: "solution.cpp" },
};

// Copia de TEMPLATES en frontend/src/components/ParticipantView.tsx.
export const TEMPLATES: Record<Language, string> = {
  python: `import sys
input = sys.stdin.readline

def solve():
  # solucion
  # ejemplo de entrada rapida:
  # # n = int(input())
  pass


def main():
  t = 1
  # t = int(input())  # Descomentar si hay varios casos de prueba
  for _ in range(t):
    solve()


if __name__ == "__main__":
  main()`,
  c: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdbool.h>
#include <stdint.h>


typedef long long ll;

void solve(void) {
    // Código de la solución aquí

}

int main(void) {
    int t = 1;
    // Descomentar si el problema tiene múltiples casos de prueba:
    // if (scanf("%d", &t) != 1) return 0;

    while (t--) {
        solve();
    }

    return 0;
}`,
  cpp: `#include <bits/stdc++.h>
using namespace std;
#define fast_io ios_base::sync_with_stdio(false); cin.tie(NULL); cout.tie(NULL);

void solve(){
    // Código de la solución aquí
}

int main() {
    fast_io;

    int t=1;
    //Descomentar si el problema tiene múltiples casos de prueba:
    //cin>>t;

    while(t--){
        solve();
    }

    return 0;
}`,
};

const MARK: Record<Language, string> = {
  python: "  # solucion\n  # ejemplo de entrada rapida:\n  # # n = int(input())\n  pass",
  c: "    // Código de la solución aquí\n",
  cpp: "    // Código de la solución aquí",
};

export const isUntouchedTemplate = (text: string) =>
  Object.values(TEMPLATES).some((template) => template.trim() === text.trim());

export type Level = "easy" | "medium" | "hard";
export const LEVELS: { id: Level; label: string }[] = [
  { id: "easy", label: "Easy" },
  { id: "medium", label: "Medium" },
  { id: "hard", label: "Hard" },
];

export type Problem = {
  id: string;
  name: string;
  level: Level;
  /** Problema original en Codeforces. */
  source: string;
  /** Límite de tiempo por prueba, en segundos (el de Codeforces). */
  seconds: number;
  statement: string;
  /** Entradas de los 2 ejemplos (casos 1 y 2 del .zip). */
  samples: string[];
  /** Solución de referencia: da la salida esperada de los ejemplos y de la entrada propia. */
  solve: (input: string) => string;
  /** El cuerpo de solve() en cada lenguaje, para "Cargar solución". */
  body: Record<Language, string>;
};

export const withSolution = (language: Language, problem: Problem) =>
  TEMPLATES[language].replace(MARK[language], problem.body[language]);

const limits = (seconds: number) =>
  `Límite de tiempo por prueba: **${seconds} ${seconds === 1 ? "segundo" : "segundos"}**  \nLímite de memoria por prueba: **256 megabytes**\n\n`;
const words = (input: string) => input.split(/\s+/).filter(Boolean);

export const PROBLEMS: Problem[] = [
  {
    id: "A",
    level: "easy",
    source: "281A",
    name: "Mayúscula inicial",
    seconds: 1,
    statement: `${limits(1)}El tablero del torneo muestra el nombre de cada equipo, pero algunos se cargaron con la primera letra en minúscula.

Escribe la palabra con su primera letra en mayúscula. Las demás letras quedan exactamente como están.

**Entrada**

Una palabra no vacía de letras inglesas mayúsculas y minúsculas. Su longitud es como mucho $10^3$.

**Salida**

La palabra con la primera letra en mayúscula.`,
    samples: ["ApPLe", "konjac"],
    solve: (i) => {
      const w = words(i)[0] ?? "";
      return w.charAt(0).toUpperCase() + w.slice(1);
    },
    body: {
      python: "  w = input().strip()\n  print(w[0].upper() + w[1:])",
      c: '    char w[1024];\n    scanf("%1023s", w);\n    if (w[0] >= \'a\' && w[0] <= \'z\') w[0] -= 32;\n    printf("%s\\n", w);\n',
      cpp: '    string w; cin >> w;\n    w[0] = toupper(w[0]);\n    cout << w << "\\n";',
    },
  },
  {
    id: "B",
    level: "easy",
    source: "617A",
    name: "Saltos a la meta",
    seconds: 1,
    statement: `${limits(1)}Tu personaje está en el punto $0$ de la pista y la meta está en el punto $x$ ($x > 0$). En cada paso puede avanzar $1$, $2$, $3$, $4$ o $5$ posiciones.

¿Cuántos pasos necesita, como mínimo, para llegar justo a la meta?

**Entrada**

Un entero $x$ ($1 \\le x \\le 1\\,000\\,000$).

**Salida**

El mínimo número de pasos.`,
    samples: ["5", "12"],
    solve: (i) => String(Math.ceil(Number(words(i)[0]) / 5)),
    body: {
      python: "  x = int(input())\n  print((x + 4) // 5)",
      c: '    int x; scanf("%d", &x);\n    printf("%d\\n", (x + 4) / 5);\n',
      cpp: '    int x; cin >> x;\n    cout << (x + 4) / 5 << "\\n";',
    },
  },
  {
    id: "C",
    level: "medium",
    source: "34B",
    name: "Liquidación de pantallas",
    seconds: 2,
    statement: `${limits(2)}Una tienda liquida $n$ pantallas. La pantalla $i$ tiene precio $a_i$, y puede ser negativo: en ese caso el dueño **te paga** $|a_i|$ para que te la lleves.

Puedes llevarte como mucho $m$ pantallas. ¿Cuánto dinero puedes ganar como máximo?

**Entrada**

La primera línea tiene $n$ y $m$ ($1 \\le m \\le n \\le 100$). La segunda, $n$ enteros $a_i$ ($-1000 \\le a_i \\le 1000$).

**Salida**

Un entero: la mayor ganancia posible.`,
    samples: ["5 3\n-6 0 35 -2 4", "4 2\n7 0 0 -7"],
    solve: (i) => {
      const [, m, ...a] = words(i).map(Number);
      const neg = a.filter((x) => x < 0).sort((x, y) => x - y).slice(0, m);
      return String(-neg.reduce((sum, x) => sum + x, 0));
    },
    body: {
      python: "  n, m = map(int, input().split())\n  a = sorted(x for x in map(int, input().split()) if x < 0)\n  print(-sum(a[:m]))",
      c: '    int n, m, a[100];\n    scanf("%d %d", &n, &m);\n    for (int i = 0; i < n; i++) scanf("%d", &a[i]);\n    for (int i = 0; i < n; i++) for (int j = i + 1; j < n; j++) if (a[j] < a[i]) { int x = a[i]; a[i] = a[j]; a[j] = x; }\n    int s = 0;\n    for (int i = 0; i < m && a[i] < 0; i++) s -= a[i];\n    printf("%d\\n", s);\n',
      cpp: '    int n, m; cin >> n >> m;\n    vector<int> a(n);\n    for (auto& x : a) cin >> x;\n    sort(a.begin(), a.end());\n    int s = 0;\n    for (int i = 0; i < m && a[i] < 0; i++) s -= a[i];\n    cout << s << "\\n";',
    },
  },
  {
    id: "D",
    level: "medium",
    source: "1373B",
    name: "Duelo 01",
    seconds: 1,
    statement: `${limits(1)}Alicia y Bruno juegan con una cadena binaria $s$. Por turnos, empezando Alicia, cada uno borra **dos caracteres vecinos distintos** (un \`0\` junto a un \`1\`). Quien no puede mover, pierde.

Si los dos juegan perfecto, ¿gana Alicia?

**Entrada**

La primera línea tiene $t$ ($1 \\le t \\le 1000$), la cantidad de partidas. Cada una de las $t$ líneas siguientes tiene una cadena $s$ de \`0\` y \`1\` ($1 \\le |s| \\le 100$).

**Salida**

Para cada partida, \`DA\` si gana Alicia o \`NET\` si no.`,
    samples: ["3\n01\n1111\n0011", "3\n10\n0\n000111"],
    solve: (i) =>
      words(i)
        .slice(1)
        .map((s) => {
          const zeros = [...s].filter((c) => c === "0").length;
          return Math.min(zeros, s.length - zeros) % 2 ? "DA" : "NET";
        })
        .join("\n"),
    body: {
      python: '  for _ in range(int(input())):\n    s = input().strip()\n    print("DA" if min(s.count("0"), s.count("1")) % 2 else "NET")',
      c: '    int t; scanf("%d", &t);\n    while (t--) {\n        char s[128]; scanf("%127s", s);\n        int z = 0, o = 0;\n        for (int i = 0; s[i]; i++) { if (s[i] == \'0\') z++; else o++; }\n        puts((z < o ? z : o) % 2 ? "DA" : "NET");\n    }\n',
      cpp: '    int t; cin >> t;\n    while (t--) {\n        string s; cin >> s;\n        int z = count(s.begin(), s.end(), \'0\'), o = s.size() - z;\n        cout << (min(z, o) % 2 ? "DA" : "NET") << "\\n";\n    }',
    },
  },
  {
    id: "E",
    level: "hard",
    source: "58A",
    name: "Saludo escondido",
    seconds: 1,
    statement: `${limits(1)}Alguien escribió un mensaje en el chat del torneo. Decimos que saludó si borrando algunas letras (o ninguna) del mensaje se puede leer \`hello\`.

¿Saludó?

**Entrada**

Una palabra $s$ de letras inglesas minúsculas ($1 \\le |s| \\le 100$).

**Salida**

\`YES\` si saludó, \`NO\` si no.`,
    samples: ["ahhellllloou", "hlelo"],
    solve: (i) => {
      let k = 0;
      for (const c of words(i)[0] ?? "") if (k < 5 && c === "hello"[k]) k++;
      return k === 5 ? "YES" : "NO";
    },
    body: {
      python: '  s = input().strip()\n  k = 0\n  for c in s:\n    if k < 5 and c == "hello"[k]:\n      k += 1\n  print("YES" if k == 5 else "NO")',
      c: '    char s[128]; scanf("%127s", s);\n    const char* h = "hello"; int k = 0;\n    for (int i = 0; s[i]; i++) if (k < 5 && s[i] == h[k]) k++;\n    puts(k == 5 ? "YES" : "NO");\n',
      cpp: '    string s; cin >> s;\n    string h = "hello"; size_t k = 0;\n    for (char c : s) if (k < h.size() && c == h[k]) k++;\n    cout << (k == h.size() ? "YES" : "NO") << "\\n";',
    },
  },
  {
    id: "F",
    level: "hard",
    source: "158B",
    name: "Taxis al estadio",
    seconds: 2,
    statement: `${limits(2)}Hay $n$ grupos de amigos que van al estadio. El grupo $i$ tiene $s_i$ personas ($1 \\le s_i \\le 4$). Cada taxi lleva como mucho $4$ personas y un grupo no se separa, aunque un taxi sí puede llevar a varios grupos.

¿Cuántos taxis hacen falta como mínimo?

**Entrada**

La primera línea tiene $n$ ($1 \\le n \\le 10^5$). La segunda, $n$ enteros $s_i$.

**Salida**

El mínimo número de taxis.`,
    samples: ["5\n1 2 4 3 3", "8\n2 3 4 4 2 1 3 1"],
    solve: (i) => {
      const c = [0, 0, 0, 0, 0];
      words(i)
        .slice(1)
        .forEach((x) => c[Number(x)]!++);
      let taxis = c[4]! + c[3]! + Math.floor(c[2]! / 2);
      let ones = Math.max(0, c[1]! - c[3]!);
      if (c[2]! % 2) {
        taxis++;
        ones = Math.max(0, ones - 2);
      }
      return String(taxis + Math.ceil(ones / 4));
    },
    body: {
      python: "  input()\n  c = [0] * 5\n  for x in sys.stdin.read().split():\n    c[int(x)] += 1\n  taxis = c[4] + c[3] + c[2] // 2\n  ones = max(0, c[1] - c[3])\n  if c[2] % 2:\n    taxis += 1\n    ones = max(0, ones - 2)\n  print(taxis + (ones + 3) // 4)",
      c: '    int n, c[5] = {0};\n    scanf("%d", &n);\n    for (int i = 0; i < n; i++) { int x; scanf("%d", &x); c[x]++; }\n    int taxis = c[4] + c[3] + c[2] / 2;\n    int ones = c[1] - c[3] > 0 ? c[1] - c[3] : 0;\n    if (c[2] % 2) { taxis++; ones = ones - 2 > 0 ? ones - 2 : 0; }\n    printf("%d\\n", taxis + (ones + 3) / 4);\n',
      cpp: '    int n; cin >> n;\n    int c[5] = {0};\n    for (int i = 0; i < n; i++) { int x; cin >> x; c[x]++; }\n    int taxis = c[4] + c[3] + c[2] / 2;\n    int ones = max(0, c[1] - c[3]);\n    if (c[2] % 2) { taxis++; ones = max(0, ones - 2); }\n    cout << taxis + (ones + 3) / 4 << "\\n";',
    },
  },
  {
    id: "G",
    level: "hard",
    source: "1914C",
    name: "Misiones del torneo",
    seconds: 2,
    statement: `${limits(2)}El torneo tiene $n$ misiones en orden. La primera vez que completas la misión $i$ ganas $a_i$ puntos de experiencia; cada vez que la repites, $b_i$. Solo puedes hacer la misión $i$ si ya completaste al menos una vez todas las anteriores.

Puedes completar misiones **como mucho $k$ veces en total**, contando las repeticiones. ¿Cuánta experiencia puedes juntar como máximo?

**Entrada**

La primera línea tiene $t$ ($1 \\le t \\le 10^4$), la cantidad de casos. Cada caso tiene una línea con $n$ y $k$ ($1 \\le n, k \\le 2 \\cdot 10^5$), una con $a_1, \\dots, a_n$ y otra con $b_1, \\dots, b_n$ ($1 \\le a_i, b_i \\le 10^3$). La suma de $n$ en todos los casos no pasa de $2 \\cdot 10^5$.

**Salida**

Para cada caso, la mayor experiencia posible.`,
    samples: [
      "4\n4 7\n4 3 1 2\n1 1 1 1\n3 2\n1 2 5\n3 1 8\n5 5\n3 2 4 1 4\n2 3 1 4 7\n6 4\n1 4 5 4 5 10\n1 5 1 2 5 1",
      "2\n2 3\n5 1\n1 10\n1 1\n7\n9",
    ],
    solve: (i) => {
      const v = words(i).map(Number);
      let p = 1;
      const out: number[] = [];
      for (let t = v[0]!; t > 0; t--) {
        const n = v[p++]!;
        const k = v[p++]!;
        const a = v.slice(p, p + n);
        const b = v.slice(p + n, p + 2 * n);
        p += 2 * n;
        let best = 0;
        let sum = 0;
        let top = 0;
        for (let j = 0; j < Math.min(n, k); j++) {
          sum += a[j]!;
          top = Math.max(top, b[j]!);
          best = Math.max(best, sum + (k - j - 1) * top);
        }
        out.push(best);
      }
      return out.join("\n");
    },
    body: {
      python: "  data = sys.stdin.read().split()\n  t, p, out = int(data[0]), 1, []\n  for _ in range(t):\n    n, k = int(data[p]), int(data[p + 1])\n    a = data[p + 2:p + 2 + n]\n    b = data[p + 2 + n:p + 2 + 2 * n]\n    p += 2 + 2 * n\n    best = s = top = 0\n    for j in range(min(n, k)):\n      s += int(a[j])\n      top = max(top, int(b[j]))\n      best = max(best, s + (k - j - 1) * top)\n    out.append(best)\n  print(\"\\n\".join(map(str, out)))",
      c: '    int t; scanf("%d", &t);\n    static int a[200000], b[200000];\n    while (t--) {\n        int n, k; scanf("%d %d", &n, &k);\n        for (int i = 0; i < n; i++) scanf("%d", &a[i]);\n        for (int i = 0; i < n; i++) scanf("%d", &b[i]);\n        ll best = 0, s = 0, top = 0;\n        for (int j = 0; j < n && j < k; j++) {\n            s += a[j]; if (b[j] > top) top = b[j];\n            ll cand = s + (ll)(k - j - 1) * top;\n            if (cand > best) best = cand;\n        }\n        printf("%lld\\n", best);\n    }\n',
      cpp: '    int t; cin >> t;\n    while (t--) {\n        int n, k; cin >> n >> k;\n        vector<long long> a(n), b(n);\n        for (auto& x : a) cin >> x;\n        for (auto& x : b) cin >> x;\n        long long best = 0, s = 0, top = 0;\n        for (int j = 0; j < min(n, k); j++) {\n            s += a[j]; top = max(top, b[j]);\n            best = max(best, s + (long long)(k - j - 1) * top);\n        }\n        cout << best << "\\n";\n    }',
    },
  },
];

export const TESTS = 30;
