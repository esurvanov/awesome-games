"""Tiny SVG diagram generator for the blog post: boxes + arrows on a grid, and sequence diagrams. Colours come from CSS classes (site tokens)."""
import html, math

def esc(s): return html.escape(s, quote=False)

def flow(nodes, edges, cols, rows, label, cw=268, ch=108, bw=168, bh=68):
    """nodes: id -> (col, row, [lines], kind)  kind: c core | x external/optional (dashed) | p person
       edges: (a, b, text, dashed)"""
    W, H = cols * cw, rows * ch
    pos = {k: (v[0] * cw + cw / 2, v[1] * ch + ch / 2) for k, v in nodes.items()}
    o = [f'<svg class="ad" viewBox="0 0 {W} {H}" role="img" aria-label="{esc(label)}" xmlns="http://www.w3.org/2000/svg"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="ad-ar"/></marker></defs>']
    def edge_pt(a, b):
        (x1, y1), (x2, y2) = pos[a], pos[b]; dx, dy = x2 - x1, y2 - y1
        if dx == 0 and dy == 0: return x1, y1
        t = min((bw / 2 + 3) / abs(dx) if dx else 1e9, (bh / 2 + 3) / abs(dy) if dy else 1e9)
        return x1 + dx * t, y1 + dy * t
    labels = []
    for a, b, text, dashed in edges:
        (x1, y1), (x2, y2) = pos[a], pos[b]
        sx, sy = edge_pt(a, b); ex, ey = edge_pt(b, a)
        o.append(f'<line x1="{sx:.1f}" y1="{sy:.1f}" x2="{ex:.1f}" y2="{ey:.1f}" class="ad-ln{" ad-ds" if dashed else ""}" marker-end="url(#ah)"/>')
        if text:
            my = (sy + ey) / 2 - (13 if abs(ey - sy) < 4 else 0)
            labels.append(((sx + ex) / 2, my, text))
    for k, (c, r, lines, kind) in nodes.items():
        x, y = pos[k]; cls = {'c': 'ad-bx ad-c', 'x': 'ad-bx ad-x', 'p': 'ad-bx ad-p'}[kind]
        rx = bh / 2 if kind == 'p' else 6
        o.append(f'<rect x="{x - bw / 2:.1f}" y="{y - bh / 2:.1f}" width="{bw}" height="{bh}" rx="{rx}" class="{cls}"/>')
        n = len(lines); y0 = y - (n - 1) * 8 + 4
        for i, ln in enumerate(lines):
            o.append(f'<text x="{x:.1f}" y="{y0 + i * 16:.1f}" text-anchor="middle" class="{"ad-t1" if i == 0 else "ad-t2"}">{esc(ln)}</text>')
    for x, y, t in labels:
        w = len(t) * 6.4 + 10
        o.append(f'<rect x="{x - w / 2:.1f}" y="{y - 9:.1f}" width="{w:.1f}" height="16" rx="3" class="ad-lbbg"/><text x="{x:.1f}" y="{y + 3:.1f}" text-anchor="middle" class="ad-lb">{esc(t)}</text>')
    o.append('</svg>')
    return ''.join(o)

def seq(parts, msgs, label, pw=132, rh=34, top=54):
    """parts: [(id, name)]; msgs: (from, to, text, kind)  kind: '' call, 'r' reply(dashed), 'n' note (from=to span), 's' self"""
    n = len(parts); W = n * pw; H = top + len(msgs) * rh + 24
    px = {p[0]: pw * i + pw / 2 for i, p in enumerate(parts)}
    o = [f'<svg class="ad" viewBox="0 0 {W} {H}" role="img" aria-label="{esc(label)}" xmlns="http://www.w3.org/2000/svg"><defs><marker id="ah2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="ad-ar"/></marker></defs>']
    for pid, name in parts:
        x = px[pid]
        o.append(f'<rect x="{x - pw / 2 + 6:.1f}" y="6" width="{pw - 12}" height="30" rx="6" class="ad-bx ad-c"/><text x="{x:.1f}" y="26" text-anchor="middle" class="ad-t1">{esc(name)}</text>')
        o.append(f'<line x1="{x:.1f}" y1="38" x2="{x:.1f}" y2="{H - 8}" class="ad-life"/>')
    for i, (a, b, text, kind) in enumerate(msgs):
        y = top + i * rh + 10
        if kind == 'n':
            x1, x2 = px[a], px[b]; half = max(52, (len(text) * 6.4 + 20) / 2 - abs(x1 - x2) / 2); xl, xr = min(x1, x2) - half, max(x1, x2) + half
            if xl < 3: xr += 3 - xl; xl = 3
            if xr > W - 3: xl -= xr - (W - 3); xr = W - 3
            o.append(f'<rect x="{xl:.1f}" y="{y - 12:.1f}" width="{xr - xl:.1f}" height="22" rx="4" class="ad-note"/><text x="{(xl + xr) / 2:.1f}" y="{y + 3:.1f}" text-anchor="middle" class="ad-t2">{esc(text)}</text>')
        elif kind == 's':
            x = px[a]
            o.append(f'<path d="M{x:.1f} {y - 6:.1f} h26 v14 h-26" class="ad-ln" fill="none" marker-end="url(#ah2)"/><text x="{x + 32:.1f}" y="{y + 4:.1f}" class="ad-lb2">{esc(text)}</text>')
        else:
            x1, x2 = px[a], px[b]; d = 1 if x2 > x1 else -1
            o.append(f'<line x1="{x1:.1f}" y1="{y:.1f}" x2="{x2 - d * 2:.1f}" y2="{y:.1f}" class="ad-ln{" ad-ds" if kind == "r" else ""}" marker-end="url(#ah2)"/>')
            tx = (x1 + x2) / 2
            o.append(f'<text x="{tx:.1f}" y="{y - 5:.1f}" text-anchor="middle" class="ad-lb2">{esc(text)}</text>')
    o.append('</svg>')
    return ''.join(o)

def fig(svg, caption): return f'<figure class="arch">{svg}<figcaption>{esc(caption)}</figcaption></figure>'


STYLE = """<style>
svg.ad{--a-bg:#ffffff;--a-surface:#ffffff;--a-ink:#17181b;--a-ink2:#4a4d57;--a-ink3:#6b6e78;--a-line:#b9bcc6;--a-accent:#3b50d8}
@media (prefers-color-scheme:dark){svg.ad{--a-bg:#0d1117;--a-surface:#161b22;--a-ink:#ecedf0;--a-ink2:#a6a9b2;--a-ink3:#8b8e98;--a-line:#454a54;--a-accent:#8b9bff}}
svg.ad .ad-bx{fill:var(--a-surface);stroke:var(--a-line);stroke-width:1.5}
svg.ad .ad-c{stroke:var(--a-accent)}
svg.ad .ad-x{stroke:var(--a-ink3);stroke-dasharray:5 4}
svg.ad .ad-p{stroke:var(--a-ink)}
svg.ad .ad-t1{fill:var(--a-ink);font:700 13px system-ui,-apple-system,"Segoe UI",sans-serif}
svg.ad .ad-t2{fill:var(--a-ink3);font:500 11px ui-monospace,Menlo,monospace}
svg.ad .ad-ln{stroke:var(--a-ink3);stroke-width:1.5;fill:none}
svg.ad .ad-ds{stroke-dasharray:5 4}
svg.ad .ad-ar{fill:var(--a-ink3)}
svg.ad .ad-lbbg{fill:var(--a-bg)}
svg.ad .ad-lb,svg.ad .ad-lb2{fill:var(--a-ink2);font:500 11px ui-monospace,Menlo,monospace}
svg.ad .ad-life{stroke:var(--a-line);stroke-width:1;stroke-dasharray:2 4}
svg.ad .ad-note{fill:var(--a-surface);stroke:var(--a-line);stroke-width:1}
</style>"""

def standalone(svg, name):
    """one self-contained .svg file: own theme variables (light/dark by the viewer), class names prefixed ad-, unique marker ids"""
    svg = svg.replace('id="ah"', f'id="{name}-ah"').replace('url(#ah)', f'url(#{name}-ah)').replace('id="ah2"', f'id="{name}-ah2"').replace('url(#ah2)', f'url(#{name}-ah2)')
    return svg.replace('<defs>', STYLE + '<defs>', 1)
