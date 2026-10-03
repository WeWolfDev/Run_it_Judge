# Página de prueba local: la de publicación + un colector de errores de consola.
import sys
d = sys.argv[1]
page = open(f"dist/{d}/page.html").read()
pre = """<!doctype html><html><head><meta charset="utf-8"><script>window.__errs=[];addEventListener('error',e=>__errs.push('error: '+e.message+' @'+(e.filename||'')+':'+e.lineno));addEventListener('unhandledrejection',e=>__errs.push('rejection: '+String(e.reason&&e.reason.stack||e.reason)));const ce=console.error;console.error=(...a)=>{__errs.push('console: '+a.map(String).join(' ').slice(0,300));ce(...a)};</script></head><body>"""
open(f"dist/{d}/test.html", "w").write(pre + page + "</body></html>")
