// Contenido del mapa de aprendizaje: mundos, temas, lecciones y ejercicios.
// Temario provisional del mundo Principiante; los otros mundos están anunciados
// y bloqueados. Cada ejercicio tiene su solución y sus casos en solutions.ts y
// public/solo-tests/<id>.json, y una fila en la tabla `ejercicios` de Supabase
// (deploy/supabase/003_solo_mapa_y_ranking.sql) con los mismos puntos.

import { SPECS } from "./solutions";

export type AnimationId =
  "io" | "overflow" | "decision" | "loop" | "array" | "string" | "stack" | "race" | "fastio";

export type Exercise = {
  id: string;
  name: string;
  points: number;
  /** Límite por caso, en segundos (el juez del navegador lo multiplica). */
  seconds: number;
  statement: string;
  samples: string[];
  solve: (input: string) => string;
};

export type Topic = {
  id: string;
  title: string;
  summary: string;
  lesson: string;
  animation: AnimationId;
  exercises: Exercise[];
};

export type World = {
  id: string;
  number: number;
  title: string;
  level: string;
  /** Sin temas todavía: se muestra bloqueado como "próximamente". */
  topics: Topic[];
};

const limits = (seconds: number) =>
  `Límite de tiempo por caso: **${seconds} ${seconds === 1 ? "segundo" : "segundos"}**  \nLímite de memoria: **256 megabytes**\n\n`;

function exercise(
  id: string,
  name: string,
  points: number,
  seconds: number,
  statement: string,
): Exercise {
  const spec = SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`Falta la solución de ${id}`);
  return {
    id,
    name,
    points,
    seconds,
    statement: limits(seconds) + statement,
    samples: spec.samples,
    solve: spec.solve,
  };
}

const PRINCIPIANTE: Topic[] = [
  {
    id: "primer-programa",
    title: "Primer programa",
    summary: "Leer de la entrada, escribir en la salida y enviar tu primera solución.",
    animation: "io",
    lesson: `Un programa de competencia **lee** datos de la entrada estándar, los **procesa** y **escribe** la respuesta en la salida estándar. El juez compara tu salida con la esperada.

\`\`\`cpp
#include <bits/stdc++.h>
using namespace std;

int main() {
    int a, b;
    cin >> a >> b;        // leer
    cout << a + b << "\\n"; // escribir
}
\`\`\`

- \`cin >> x\` salta espacios y saltos de línea: no importa cómo vengan separados los datos.
- Escribe **exactamente** lo que pide el enunciado, sin mensajes como "Ingresa un número".
- \`"\\n"\` termina la línea. Al final no importa si sobra un espacio o un salto.`,
    exercises: [
      exercise(
        "ini-saludo",
        "Hola, Run It",
        10,
        1,
        `Escribe un programa que salude a quien lo usa.

**Entrada**

Un nombre: una sola palabra de letras inglesas, de 1 a 20 letras.

**Salida**

\`Hola, \` seguido del nombre y un signo de admiración.`,
      ),
      exercise(
        "ini-suma",
        "La primera suma",
        10,
        1,
        `Lee dos números enteros y escribe su suma.

**Entrada**

Dos enteros $a$ y $b$ ($-10^6 \\le a, b \\le 10^6$), separados por un espacio.

**Salida**

El valor de $a + b$.`,
      ),
    ],
  },
  {
    id: "tipos",
    title: "Tipos y overflow",
    summary: "int, long long y por qué un número puede «dar la vuelta».",
    animation: "overflow",
    lesson: `Cada variable tiene un **tipo** con un rango fijo:

- \`int\`: hasta unos $\\pm 2.1 \\cdot 10^9$.
- \`long long\`: hasta unos $\\pm 9.2 \\cdot 10^{18}$.

Si un cálculo se pasa del rango hay **overflow**: el número «da la vuelta» y aparece un valor sin sentido, sin ningún error.

\`\`\`cpp
int a = 1000000000, b = 1000000000;
cout << a * b;            // overflow: basura
cout << 1LL * a * b;      // 1000000000000000000
\`\`\`

Regla práctica: si un resultado puede pasar de $2 \\cdot 10^9$, usa \`long long\` **antes** de operar.`,
    exercises: [
      exercise(
        "ini-producto",
        "Producto gigante",
        20,
        1,
        `Lee dos enteros positivos y escribe su producto.

**Entrada**

Dos enteros $a$ y $b$ ($1 \\le a, b \\le 10^9$).

**Salida**

El valor de $a \\cdot b$.`,
      ),
      exercise(
        "ini-tiempo",
        "Minutos y segundos",
        20,
        1,
        `Un cronómetro marca $S$ segundos. Escríbelo en minutos y segundos.

**Entrada**

Un entero $S$ ($0 \\le S \\le 10^9$).

**Salida**

Dos enteros: los minutos completos y los segundos que sobran (de 0 a 59).`,
      ),
    ],
  },
  {
    id: "condicionales",
    title: "Condicionales",
    summary: "if, else y operadores para tomar decisiones.",
    animation: "decision",
    lesson: `Con \`if\` el programa elige qué hacer según una condición.

\`\`\`cpp
if (n % 2 == 0) {
    cout << "PAR\\n";
} else {
    cout << "IMPAR\\n";
}
\`\`\`

- Comparaciones: \`==\`, \`!=\`, \`<\`, \`<=\`, \`>\`, \`>=\`.
- Combinar: \`&&\` (y), \`||\` (o), \`!\` (no).
- Cuidado: en C++, \`-7 % 2\` vale \`-1\`, no \`1\`. Para saber si es impar compara con \`!= 0\`.
- Piensa en los **casos borde**: el 0, los negativos, los valores iguales.`,
    exercises: [
      exercise(
        "ini-paridad",
        "¿Par o impar?",
        20,
        1,
        `Decide si un número es par o impar.

**Entrada**

Un entero $n$ ($-10^9 \\le n \\le 10^9$).

**Salida**

\`PAR\` si $n$ es par, o \`IMPAR\` si no.`,
      ),
      exercise(
        "ini-mayor",
        "El mayor de tres",
        20,
        1,
        `Lee tres enteros y escribe el mayor.

**Entrada**

Tres enteros $a$, $b$ y $c$ ($-10^9 \\le a, b, c \\le 10^9$).

**Salida**

El mayor de los tres.`,
      ),
    ],
  },
  {
    id: "bucles",
    title: "Bucles",
    summary: "for y while para repetir sin copiar código.",
    animation: "loop",
    lesson: `Un **bucle** repite instrucciones. El más común en competencia es \`for\`:

\`\`\`cpp
long long suma = 0;
for (int i = 1; i <= n; i++) {
    suma += i;
}
\`\`\`

- \`int i = 1\`: empieza en 1. \`i <= n\`: sigue mientras se cumpla. \`i++\`: avanza.
- \`while (condición)\` sirve cuando no sabes cuántas vueltas habrá.
- Muchos problemas traen **varios casos**: lee \`t\` y repite la solución \`t\` veces.
- Ojo con el tipo del acumulador: la suma puede necesitar \`long long\`.`,
    exercises: [
      exercise(
        "ini-suma-n",
        "Suma hasta n",
        20,
        1,
        `Calcula $1 + 2 + \\dots + n$.

**Entrada**

Un entero $n$ ($1 \\le n \\le 10^6$).

**Salida**

La suma de los enteros de 1 a $n$.`,
      ),
      exercise(
        "ini-tabla",
        "Tabla de multiplicar",
        20,
        1,
        `Escribe la tabla de multiplicar de $n$, del 1 al 10.

**Entrada**

Un entero $n$ ($1 \\le n \\le 1000$).

**Salida**

Diez líneas. La línea $i$ es \`n x i = r\`, donde $r = n \\cdot i$.`,
      ),
    ],
  },
  {
    id: "arreglos",
    title: "Arrays y vector",
    summary: "Guardar muchos valores y recorrerlos.",
    animation: "array",
    lesson: `Un \`vector\` guarda muchos valores del mismo tipo, uno detrás de otro:

\`\`\`cpp
int n;
cin >> n;
vector<long long> a(n);
for (int i = 0; i < n; i++) cin >> a[i];
\`\`\`

- Los índices van de \`0\` a \`n - 1\`. Leer \`a[n]\` es un error que puede no avisar.
- Para buscar el máximo, recorre el arreglo y quédate con el mejor visto **hasta ahora**.
- \`a.size()\` da la cantidad de elementos; \`a.push_back(x)\` agrega uno al final.`,
    exercises: [
      exercise(
        "ini-maximo",
        "El máximo y dónde está",
        30,
        1,
        `Encuentra el mayor valor de un arreglo y su posición.

**Entrada**

Un entero $n$ ($1 \\le n \\le 5 \\cdot 10^4$) y luego $n$ enteros $a_1, \\dots, a_n$ ($-10^9 \\le a_i \\le 10^9$).

**Salida**

El valor máximo y la posición (empezando en 1) de su **primera** aparición.`,
      ),
      exercise(
        "ini-invertir",
        "Al revés",
        30,
        1,
        `Escribe el arreglo en orden inverso.

**Entrada**

Un entero $n$ ($1 \\le n \\le 5 \\cdot 10^4$) y luego $n$ enteros ($-10^9 \\le a_i \\le 10^9$).

**Salida**

Los $n$ enteros del último al primero, separados por espacios.`,
      ),
    ],
  },
  {
    id: "strings",
    title: "Strings",
    summary: "Texto como arreglo de caracteres.",
    animation: "string",
    lesson: `Un \`string\` es una secuencia de caracteres, y se recorre como un arreglo:

\`\`\`cpp
string s;
cin >> s;
int vocales = 0;
for (char c : s) {
    if (c == 'a' || c == 'e' || c == 'i' || c == 'o' || c == 'u') vocales++;
}
\`\`\`

- \`s.size()\` es la longitud; \`s[i]\` es el carácter en la posición \`i\`.
- Los caracteres van entre comillas simples: \`'a'\`. Los strings, entre dobles: \`"hola"\`.
- Para comparar extremos usa dos índices: \`s[i]\` y \`s[n - 1 - i]\`.`,
    exercises: [
      exercise(
        "ini-vocales",
        "Contar vocales",
        30,
        1,
        `Cuenta las vocales de una palabra.

**Entrada**

Una palabra de letras minúsculas sin acentos, de 1 a $10^5$ letras.

**Salida**

La cantidad de vocales (a, e, i, o, u).`,
      ),
      exercise(
        "ini-palindromo",
        "¿Palíndromo?",
        30,
        1,
        `Una palabra es **palíndromo** si se lee igual de izquierda a derecha que al revés.

**Entrada**

Una palabra de letras minúsculas, de 1 a $10^5$ letras.

**Salida**

\`SI\` si es palíndromo, o \`NO\` si no.`,
      ),
    ],
  },
  {
    id: "funciones",
    title: "Funciones",
    summary: "Separar el problema en piezas reutilizables.",
    animation: "stack",
    lesson: `Una **función** recibe datos, calcula y devuelve un resultado. Evita repetir código:

\`\`\`cpp
bool esPrimo(long long x) {
    if (x < 2) return false;
    for (long long d = 2; d * d <= x; d++)
        if (x % d == 0) return false;
    return true;
}
\`\`\`

- Cada llamada crea su propio espacio en la **pila de llamadas** y desaparece al terminar.
- Una función puede llamarse a sí misma (**recursión**), como el algoritmo de Euclides: \`mcd(a, b) = mcd(b, a % b)\`.
- Para probar primalidad basta revisar divisores hasta $\\sqrt{x}$.`,
    exercises: [
      exercise(
        "ini-mcd",
        "Máximo común divisor",
        30,
        1,
        `Calcula el máximo común divisor de dos números.

**Entrada**

Dos enteros $a$ y $b$ ($1 \\le a, b \\le 10^9$).

**Salida**

El mayor entero que divide a ambos.`,
      ),
      exercise(
        "ini-primos",
        "¿Es primo?",
        40,
        2,
        `Responde varias preguntas: ¿es primo cada número?

**Entrada**

Un entero $q$ ($1 \\le q \\le 1000$) y luego $q$ enteros $x$ ($1 \\le x \\le 10^7$).

**Salida**

Para cada $x$, una línea con \`SI\` si es primo, o \`NO\` si no.`,
      ),
    ],
  },
  {
    id: "complejidad",
    title: "Complejidad",
    summary: "Por qué una solución correcta puede dar Tiempo excedido.",
    animation: "race",
    lesson: `La **complejidad** mide cuántas operaciones hace tu programa según el tamaño $n$ de la entrada. Una computadora hace unas $10^8$ operaciones por segundo.

- $n \\le 10^3$: alcanza con $O(n^2)$.
- $n \\le 10^5$: hace falta $O(n \\log n)$.
- $n \\le 10^7$: hace falta $O(n)$.

Revisar **todos los pares** es $O(n^2)$: con $n = 5 \\cdot 10^4$ son más de $10^9$ operaciones y no termina a tiempo. Muchas veces basta con **contar** en una sola pasada:

\`\`\`cpp
long long pares = 0, impares = 0;
for (long long x : a) (x % 2 == 0 ? pares : impares)++;
\`\`\``,
    exercises: [
      exercise(
        "ini-pares",
        "Parejas de suma par",
        50,
        1,
        `¿Cuántas parejas $(i, j)$ con $i < j$ cumplen que $a_i + a_j$ es par?

**Entrada**

Un entero $n$ ($1 \\le n \\le 5 \\cdot 10^4$) y luego $n$ enteros ($1 \\le a_i \\le 10^9$).

**Salida**

La cantidad de parejas. Una solución que pruebe todas las parejas no termina a tiempo.`,
      ),
      exercise(
        "ini-distintos",
        "Valores distintos",
        40,
        1,
        `Cuenta cuántos valores distintos hay en el arreglo.

**Entrada**

Un entero $n$ ($1 \\le n \\le 5 \\cdot 10^4$) y luego $n$ enteros ($1 \\le a_i \\le 10^6$).

**Salida**

La cantidad de valores distintos.`,
      ),
    ],
  },
  {
    id: "entrada-rapida",
    title: "I/O rápido",
    summary: "La plantilla del club para leer mucha entrada a tiempo.",
    animation: "fastio",
    lesson: `Con entradas grandes, leer y escribir puede tardar más que el algoritmo. Dos líneas al inicio de \`main\` lo resuelven:

\`\`\`cpp
int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    // ...
}
\`\`\`

- \`sync_with_stdio(false)\` separa \`cin\`/\`cout\` de \`scanf\`/\`printf\`: no los mezcles después.
- \`cin.tie(nullptr)\` evita vaciar la salida antes de cada lectura.
- Usa \`"\\n"\` en vez de \`endl\`: \`endl\` vacía la salida cada vez.

Ya viene en la plantilla del editor: ahora sabes para qué sirve.`,
    exercises: [
      exercise(
        "ini-entrada-grande",
        "Mucha entrada",
        40,
        1,
        `Suma todos los números de una entrada grande.

**Entrada**

Un entero $n$ ($1 \\le n \\le 10^5$) y luego $n$ enteros ($-10^9 \\le a_i \\le 10^9$).

**Salida**

La suma de los $n$ enteros.`,
      ),
    ],
  },
];

export const WORLDS: World[] = [
  {
    id: "principiante",
    number: 1,
    title: "Fundamentos",
    level: "Principiante",
    topics: PRINCIPIANTE,
  },
  { id: "intermedio", number: 2, title: "Algoritmos", level: "Intermedio", topics: [] },
  { id: "avanzado", number: 3, title: "Jefe final", level: "Avanzado", topics: [] },
];

export const ALL_EXERCISES: Exercise[] = WORLDS.flatMap((w) =>
  w.topics.flatMap((t) => t.exercises),
);

export const TOTAL_POINTS = ALL_EXERCISES.reduce((sum, e) => sum + e.points, 0);

/** Nivel del jugador: uno nuevo cada 100 puntos. */
export const levelOf = (points: number) => Math.floor(points / 100) + 1;
