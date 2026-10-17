// Código simulado de los envíos de la demo del caster, para "El marcador de Leo"
// (ordenar los sumandos de una suma de 1, 2 y 3). Cada veredicto tiene un error
// que lo explica, y el lenguaje sale del error (un SIGFPE es de C, un NZEC de
// Python). En la app real el código y el resultado de cada caso vienen de
// submissions.code y submissions.case_results.

export type SubLanguage = "python" | "c" | "cpp";

const AC: Record<SubLanguage, string> = {
  python: `s = input().strip()
nums = s.split("+")
nums.sort()
print("+".join(nums))
`,
  c: `#include <stdio.h>

int main(void) {
    char s[128];
    int count[4] = {0};
    scanf("%127s", s);
    for (int i = 0; s[i]; i++)
        if (s[i] != '+') count[s[i] - '0']++;

    int first = 1;
    for (int d = 1; d <= 3; d++)
        while (count[d]--) {
            if (!first) putchar('+');
            printf("%d", d);
            first = 0;
        }
    putchar('\\n');
    return 0;
}
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    string s;
    cin >> s;
    vector<char> d;
    for (char c : s)
        if (c != '+') d.push_back(c);
    sort(d.begin(), d.end());
    for (size_t i = 0; i < d.size(); i++) {
        if (i) cout << '+';
        cout << d[i];
    }
    cout << "\\n";
}
`,
};

// Respuesta incorrecta con algunos tests bien: el error solo aparece en ciertas
// entradas (sumandos distintos, algún 3, el último sumando no es el mayor).
const WA: Record<SubLanguage, string> = {
  python: `s = input().strip()
nums = s.split("+")
nums.sort(reverse=True)   # de mayor a menor
print("+".join(nums))
`,
  c: `#include <stdio.h>

int main(void) {
    char s[128];
    int unos = 0, doses = 0;
    scanf("%127s", s);
    for (int i = 0; s[i]; i++) {
        if (s[i] == '1') unos++;
        if (s[i] == '2') doses++;
        // los 3 no se cuentan
    }
    int first = 1;
    while (unos--) { if (!first) putchar('+'); putchar('1'); first = 0; }
    while (doses--) { if (!first) putchar('+'); putchar('2'); first = 0; }
    putchar('\\n');
    return 0;
}
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    string s;
    cin >> s;
    vector<char> d;
    for (char c : s)
        if (c != '+') d.push_back(c);
    sort(d.begin(), d.end() - 1);   // deja afuera el último sumando
    for (size_t i = 0; i < d.size(); i++) {
        if (i) cout << '+';
        cout << d[i];
    }
    cout << "\\n";
}
`,
};

// Tiempo excedido: el índice no avanza al encontrar un '+'.
// Respuesta incorrecta en todos los casos: el formato de salida está mal.
const WA_NONE: { language: SubLanguage; code: string } = {
  language: "cpp",
  code: `#include <bits/stdc++.h>
using namespace std;

int main() {
    string s;
    cin >> s;
    vector<char> d;
    for (char c : s)
        if (c != '+') d.push_back(c);
    sort(d.begin(), d.end());
    for (char c : d) cout << c << '+';   // deja un + al final
    cout << "\\n";
}
`,
};

const TLE: Record<SubLanguage, string> = {
  python: `s = input().strip()
nums = []
i = 0
while i < len(s):
    if s[i] == "+":
        continue          # i nunca avanza
    nums.append(s[i])
    i += 1
nums.sort()
print("+".join(nums))
`,
  c: `#include <stdio.h>
#include <string.h>

int main(void) {
    char s[128];
    int count[4] = {0};
    scanf("%127s", s);
    int i = 0, n = strlen(s);
    while (i < n) {
        if (s[i] == '+') continue;   // i nunca avanza
        count[s[i] - '0']++;
        i++;
    }
    int first = 1;
    for (int d = 1; d <= 3; d++)
        while (count[d]--) {
            if (!first) putchar('+');
            printf("%d", d);
            first = 0;
        }
    putchar('\\n');
    return 0;
}
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    string s;
    cin >> s;
    vector<char> d;
    size_t i = 0;
    while (i < s.size()) {
        if (s[i] == '+') continue;   // i nunca avanza
        d.push_back(s[i]);
        i++;
    }
    sort(d.begin(), d.end());
    for (size_t k = 0; k < d.size(); k++) {
        if (k) cout << '+';
        cout << d[k];
    }
    cout << "\\n";
}
`,
};

const CE: Record<"c" | "cpp", string> = {
  c: `#include <stdio.h>

int main(void) {
    char s[128];
    int count[4] = {0}
    scanf("%127s", s);
    for (int i = 0; s[i]; i++)
        if (s[i] != '+') count[s[i] - '0']++;
    return 0;
}
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    string s;
    cin >> s
    vector<char> d;
    for (char c : s)
        if (c != '+') d.push_back(c);
    sort(d.begin(), d.end());
    for (char c : d) cout << c;
}
`,
};

// Errores de ejecución: cada señal con el lenguaje en el que suele salir.
const RE: Record<string, { language: SubLanguage; code: string }> = {
  "Runtime Error (NZEC)": {
    language: "python",
    code: `s = input().strip()
nums = sorted(map(int, s.split()))   # separa por espacios, no por +
print("+".join(map(str, nums)))
`,
  },
  "Runtime Error (SIGSEGV)": {
    language: "cpp",
    code: `#include <bits/stdc++.h>
using namespace std;

int main() {
    string s;
    cin >> s;
    char d[20];          // entran hasta 20 sumandos; s puede tener 51
    int k = 0;
    for (char c : s)
        if (c != '+') d[k++] = c;
    sort(d, d + k);
    for (int i = 0; i < k; i++) {
        if (i) cout << '+';
        cout << d[i];
    }
    cout << "\\n";
}
`,
  },
  "Runtime Error (SIGFPE)": {
    language: "c",
    code: `#include <stdio.h>

int main(void) {
    char s[128];
    int count[4] = {0}, total = 0, sumandos = 0;
    scanf("%127s", s);
    for (int i = 0; s[i]; i++)
        if (s[i] != '+') { count[s[i] - '0']++; total += s[i] - '0'; sumandos++; }
    int promedio = total / (sumandos - 1);   // con un solo sumando divide por 0
    (void)promedio;
    int first = 1;
    for (int d = 1; d <= 3; d++)
        while (count[d]--) {
            if (!first) putchar('+');
            printf("%d", d);
            first = 0;
        }
    putchar('\\n');
    return 0;
}
`,
  },
};

const LANGUAGES: SubLanguage[] = ["python", "c", "cpp"];
const pickLanguage = (seed: number) =>
  LANGUAGES[Math.abs(seed) % 3] as SubLanguage;

/**
 * Código de un envío según su veredicto y cuántos casos pasó: el error tiene que
 * explicar el resultado (un WA con 0/30 no puede ser uno que falla a veces).
 */
export function codeFor(
  verdict: string,
  seed: number,
  passed: number,
): { language: SubLanguage; code: string } {
  const re = RE[verdict];
  if (re) return re;
  if (verdict === "Compilation Error") {
    const language = seed % 2 ? "c" : "cpp";
    return { language, code: CE[language] };
  }
  if (verdict === "Wrong Answer" && passed === 0) return WA_NONE;
  const language = pickLanguage(seed);
  const bank =
    verdict === "accepted" ? AC : verdict === "Time Limit Exceeded" ? TLE : WA;
  return { language, code: bank[language] };
}

/**
 * Resultado de cada uno de los `total` casos: "ok" o el veredicto del caso.
 * Pasan `passed` casos, repartidos de forma estable según `seed`.
 */
export function caseResults(
  seed: number,
  verdict: string,
  passed: number,
  total: number,
) {
  if (verdict === "accepted") return Array.from({ length: total }, () => "ok");
  if (verdict === "Compilation Error")
    return Array.from({ length: total }, () => verdict);
  // Los casos chicos (los primeros) son los que más pasan.
  const order = Array.from({ length: total }, (_, i) => i).sort(
    (a, b) => a + noise(seed, a) * 12 - (b + noise(seed, b) * 12),
  );
  const ok = new Set(order.slice(0, passed));
  return Array.from({ length: total }, (_, i) => (ok.has(i) ? "ok" : verdict));
}

function noise(seed: number, i: number) {
  const x = Math.sin(seed * 9301 + i * 49297) * 233280;
  return x - Math.floor(x);
}
