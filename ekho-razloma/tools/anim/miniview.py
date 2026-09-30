"""Tiny numpy triangle rasteriser (orthographic, z-buffer, flat shading) for looking at the skinned pilot without a browser.
    img = render(V, F, colors, eye_dir, up, centre, half, size)   # V world verts, F faces, colors per vertex (n,3) 0-255
    save_png(path, img); planes=[(P0,N)] draws a surface as a thin line/grid
"""
import numpy as np, zlib, struct

def save_png(path, img):
    h, w, _ = img.shape; raw = b''.join(b'\x00' + img[y].tobytes() for y in range(h))
    def ch(t, d): c = struct.pack('>I', len(d)) + t + d; return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b''))

def render(V, F, colors, view, up, centre, half, size=(560, 560), planes=(), bg=(236, 238, 240)):
    """view = direction the camera LOOKS along (world), up = world up hint; half = half-height in metres"""
    w, h = size; view = np.asarray(view, float); view /= np.linalg.norm(view)
    r = np.cross(view, up); r /= np.linalg.norm(r); u = np.cross(r, view)
    def proj(P):
        d = P - centre; return np.stack([d @ r, d @ u, d @ view], 1)
    Q = proj(V); sc = h / (2 * half)
    X = w / 2 + Q[:, 0] * sc; Y = h / 2 - Q[:, 1] * sc; Z = Q[:, 2]
    img = np.zeros((h, w, 3), np.float64); img[:] = bg; zb = np.full((h, w), 1e9)
    N = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]); N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-12)
    light = -view * 0.7 + r * 0.3 + u * 0.4; light /= np.linalg.norm(light)
    for t in range(len(F)):
        a, b, c = F[t]
        x0, x1, x2 = X[a], X[b], X[c]; y0, y1, y2 = Y[a], Y[b], Y[c]
        xmin = max(int(np.floor(min(x0, x1, x2))), 0); xmax = min(int(np.ceil(max(x0, x1, x2))), w - 1)
        ymin = max(int(np.floor(min(y0, y1, y2))), 0); ymax = min(int(np.ceil(max(y0, y1, y2))), h - 1)
        if xmin > xmax or ymin > ymax: continue
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(den) < 1e-9: continue
        gx, gy = np.meshgrid(np.arange(xmin, xmax + 1) + 0.5, np.arange(ymin, ymax + 1) + 0.5)
        l0 = ((y1 - y2) * (gx - x2) + (x2 - x1) * (gy - y2)) / den; l1 = ((y2 - y0) * (gx - x2) + (x0 - x2) * (gy - y2)) / den; l2 = 1 - l0 - l1
        m = (l0 >= -1e-6) & (l1 >= -1e-6) & (l2 >= -1e-6)
        if not m.any(): continue
        z = l0 * Z[a] + l1 * Z[b] + l2 * Z[c]
        sub = zb[ymin:ymax + 1, xmin:xmax + 1]; upd = m & (z < sub)
        if not upd.any(): continue
        sub[upd] = z[upd]
        sh = 0.35 + 0.65 * abs(float(N[t] @ light))
        col = (colors[a] + colors[b] + colors[c]) / 3 * sh
        img[ymin:ymax + 1, xmin:xmax + 1][upd] = col
    for P0, Nn in planes:   # surface: draw the plane's cut as a translucent band (edge-on line) and dotted grid
        Nn = np.asarray(Nn, float); Nn /= np.linalg.norm(Nn)
        dv = float(Nn @ view)
        pts = np.array([[P0 + r * a + u * b for a in np.linspace(-half, half, 60)] for b in np.linspace(-half, half, 60)]).reshape(-1, 3)
        # pixels of the plane: intersection of camera rays with the plane
        yy, xx = np.mgrid[0:h, 0:w]
        wx = (xx + 0.5 - w / 2) / sc; wy = -(yy + 0.5 - h / 2) / sc
        origin = centre + r * wx[..., None] + u * wy[..., None]
        if abs(dv) > 1e-3:
            tt = ((P0 - origin) @ Nn) / dv; zz = tt   # depth along view from centre plane
            hit = origin + view * tt[..., None]
            behind = zb > (hit - centre) @ view + 1e-4                     # plane is in front of geometry
            g = (((hit @ r) * 20).astype(int) + ((hit @ u) * 20).astype(int)) % 2 == 0
            m = behind & (np.abs(tt) < 3)
            img[m] = img[m] * 0.55 + np.array([80, 160, 255]) * 0.45 * (0.7 + 0.3 * g[m][:, None])
        else:
            pass
        # edge-on: draw a line where the plane crosses the view plane
        d = ((origin - P0) @ Nn)
        line = np.abs(d) < (1.2 / sc)
        img[line] = (30, 120, 255)
    return img.astype(np.uint8)
