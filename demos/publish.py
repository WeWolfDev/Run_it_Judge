# Prepara dist/<demo> para publicarlo como Artifact: página sin <html>/<head>,
# CSS adentro, rutas de public/ relativas y un files.json con lo que se sube.
# Uso: python3 publish.py admin|participante
import json, os, re, sys

demo = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
dist = os.path.join(here, "dist", demo)
html = open(os.path.join(dist, "index.html")).read()
titles = {"admin": "Panel Admin Run It", "participante": "Vista Participante Run It", "pista": "Pista Run It", "login": "Login Run It", "proyeccion": "Pista proyectada Run It", "premios": "Ceremonia de premios Run It", "eliminado": "Eliminado Run It", "publico": "Vistas del público Run It", "votos": "Voto del público Run It"}

css_files = re.findall(r'<link rel="stylesheet" crossorigin href="\./(assets/[^"]+\.css)">', html)
css = "".join(open(os.path.join(dist, f)).read() for f in css_files)
assert "url(./" not in css and "url(/" not in css.replace("url(/*", ""), "El CSS todavía apunta a archivos"
scripts = re.findall(r'<script type="module" crossorigin src="\./(assets/[^"]+)"></script>', html)
preloads = re.findall(r'<link rel="modulepreload" crossorigin href="\./(assets/[^"]+)">', html)

pub_root = os.path.join(here, "public")
public = set()
for base, _dirs, names in os.walk(pub_root):
    for n in names:
        public.add(os.path.relpath(os.path.join(base, n), pub_root))
used_public = set()
for name in os.listdir(os.path.join(dist, "assets")):
    if not name.endswith(".js"):
        continue
    path = os.path.join(dist, "assets", name)
    js = open(path, encoding="utf8").read()
    for item in public:
        # Rutas entre comillas o dentro de url(...) en estilos puestos desde el JS.
        for left, right in (('"', '"'), ("'", "'"), ("`", "`"), ("url(", ")")):
            needle = f"{left}/{item}{right}"
            if needle in js:
                js = js.replace(needle, f"{left}./{item}{right}")
                used_public.add(item)
            if f"{left}./{item}{right}" in js:
                used_public.add(item)
    # El minificador deja U+FFFD literal; la publicación lo rechaza.
    js = js.replace("�", "\\ufffd")
    open(path, "w", encoding="utf8").write(js)

page = f"""<title>{titles[demo]}</title>
<meta name="description" content="Demo de Run It con backend simulado">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>{css}</style>
<div id="root"></div>
{"".join(f'<link rel="modulepreload" href="./{p}">' for p in preloads)}
{"".join(f'<script type="module" src="./{s}"></script>' for s in scripts)}
"""
open(os.path.join(dist, "page.html"), "w", encoding="utf8").write(page)

files = {f"assets/{n}": os.path.join(dist, "assets", n) for n in os.listdir(os.path.join(dist, "assets")) if not n.endswith(".css")}
# Las hojas de personajes se piden con rutas armadas en tiempo de ejecución.
if demo != "login":
    used_public |= {n for n in public if n.startswith("chars/")}
files.update({n: os.path.join(dist, n) for n in used_public})
json.dump(files, open(os.path.join(dist, "files.json"), "w"), indent=1)
print(demo, "página", len(page) // 1024, "KB ·", len(files), "archivos ·", sorted(used_public))
