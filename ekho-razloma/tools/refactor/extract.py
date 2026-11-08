#!/usr/bin/env python3
"""Move a block of lines out of an IIFE module into its own file, verbatim, and leave a factory call in its place.
   python3 tools/refactor/extract.py <source.js> <first-line> <last-line> <new-module.js> <FactoryName> <Obj> "<exports,comma>" "<late,comma>" "<header text>"
   free names of the block that the source declares before it → deps passed in; names in <late> (assigned later in the source, e.g. C, V3) → locals set by Obj.bind({...});
   names the block declares that the rest of the source uses → returned (must be const/function). Prints what it did and any name it could not place."""
import re, subprocess, sys, os
src, a, b, out, fac, obj, exports, late, header = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5], sys.argv[6], sys.argv[7], sys.argv[8], sys.argv[9]
exports = [x for x in exports.split(',') if x]; late = [x for x in late.split(',') if x]
here = os.path.dirname(os.path.abspath(__file__)); free = os.environ.get('FREE_CJS')
L = open(src, encoding='utf8').read().split('\n'); sec = L[a-1:b]; txt = '\n'.join(sec)
tmp = '/tmp/_extract_sec.js'
# the free-name analysis uses an old parser: `?.` and `??` are rewritten for the analysis only (the moved text itself is untouched)
ana = re.sub(r'\?\.(?=[\w\[(])', '.', txt).replace(' ?? ', ' || ')
open(tmp, 'w', encoding='utf8').write(ana)
r = subprocess.run(['node', free, tmp, '1', str(b-a+1)], capture_output=True, text=True).stdout.split('\n')
if r[0].startswith('PARSE'): sys.exit('parse error: ' + r[0])
fv = [t.split(':')[0] for t in r[0].split()]
glob = set('window document Math Object Array Map Set WeakMap WeakSet JSON Number String Boolean Date Float32Array Float64Array Uint8Array Uint16Array Uint32Array Int32Array Infinity NaN undefined isFinite isNaN parseFloat parseInt console performance Error Promise Symbol requestAnimationFrame setTimeout clearTimeout location navigator'.split())
fv = [n for n in fv if n not in glob]
rest = '\n'.join(L[:a-1] + L[b:])
declared_here = set(re.findall(r'^  (?:const|let|(?:async\s+)?function)\s+([A-Za-z_\$][\w\$]*)', txt, re.M))
for m in re.finditer(r'^  (?:const|let)\s+\{([^}]*)\}', txt, re.M):
    for n in m.group(1).split(','): declared_here.add(n.strip().split(':')[-1].strip())
deps, lates, problems, auto_late, privates = [], [], [], [], []
def decl_line(n):
    for i, l in enumerate(L):
        if re.match(r'^  (?:const|let|function)\s+' + re.escape(n) + r'\b', l) or re.match(r'^  (?:const|let)\s+[^=\n]*\b' + re.escape(n) + r'\b[^=\n]*=', l) or re.match(r'^  let\s+[^;\n]*\b' + re.escape(n) + r'\b', l): return i + 1
    return None
for n in fv:
    if n in declared_here: continue
    if n in late: lates.append(n); continue
    dl = decl_line(n)
    if dl is None: problems.append(n + ' (global?)'); continue
    mlet = re.match(r'^  let\s+' + re.escape(n) + r'\s*=\s*([^;,]+);', L[dl-1])
    if mlet and re.search(r'(?<![\w.$])' + re.escape(n) + r'\s*=[^=]', txt):
        privates.append((n, mlet.group(1).strip())); continue   # assigned inside the block: the block gets its own copy (fine for scratch/cache values — checked by hand)
    if dl > b: lates.append(n); auto_late.append(n); continue   # declared after the block (a later block's export, or a const further down): assigned through bind() once it exists
    deps.append(n)
used_out = [n for n in sorted(declared_here) if re.search(r'(?<![\w.$])' + re.escape(n) + r'(?![\w$])', rest)]
bad = [n for n in used_out if n not in exports]
if bad: problems.append('used outside but not exported: ' + ','.join(bad))
for n in exports:
    ln = [l for l in sec if re.match(r'^  let\s+' + re.escape(n) + r'\b', l)]
    if ln: problems.append('exported name is a let: ' + n)
body = '\n'.join(sec)
items = list(exports)
if lates: items.append('bind(o) { ' + ' '.join('if ("%s" in o) %s = o.%s;' % (n, n, n) for n in lates) + ' }')
mod = "/* %s */\n(function () {\n  'use strict';\n  window.%s = function (X) {\n" % (header, fac)
if deps: mod += "    const { %s } = X;\n" % ', '.join(deps)
if privates: mod += ''.join('    let %s = %s;   // private copy (was shared in the source module)\n' % (n, v) for n, v in privates)
if lates: mod += "    let %s;   // assigned later in the source module: set through bind()\n" % ', '.join(lates)
mod += body + "\n\n    return { %s };\n  };\n})();\n" % ', '.join(items)
open(out, 'w', encoding='utf8').write(mod)
call = [f"  const {obj} = window.{fac}({{ {', '.join(deps)} }});   // {os.path.basename(out)}"]
if exports: call.append(f"  const {{ {', '.join(exports)} }} = {obj};")
L[a-1:b] = call
open(src, 'w', encoding='utf8').write('\n'.join(L))
print('block', a, b, '→', out); print('deps:', deps); print('late:', lates, '(declared later, bind them:', auto_late, ')'); print('exports:', exports); print('private copies:', privates)
if problems: print('PROBLEMS:', problems)
