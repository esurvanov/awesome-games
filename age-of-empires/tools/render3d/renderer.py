"""Offline rendering of an actor's parts (Part) into an isometric sprite: moderngl (headless), supersampling,
a shadow map from the sun, a cast shadow onto the ground plane, the player color mask.

The result of render(): Sprite(rgba (H,W,4) uint8 - a straight alpha channel, mask (H,W) uint8 - the player color share,
ox, oy - the pixel where the ground point (0, 0, 0) projects, i.e. the top corner of the building's base).
"""
from dataclasses import dataclass

import numpy as np

from . import assets, camera

VS = """
#version 330
uniform mat4 u_view;
uniform mat4 u_light;
in vec3 in_pos;
in vec3 in_nrm;
in vec2 in_uv0;
in vec2 in_uv1;
out vec3 v_pos;
out vec3 v_nrm;
out vec2 v_uv0;
out vec2 v_uv1;
out vec3 v_lpos;
void main() {
    v_pos = in_pos;
    v_nrm = in_nrm;
    v_uv0 = in_uv0;
    v_uv1 = in_uv1;
    vec4 lp = u_light * vec4(in_pos, 1.0);
    v_lpos = lp.xyz * 0.5 + 0.5;
    gl_Position = u_view * vec4(in_pos, 1.0);
}
"""

SHADOW_FN = """
uniform sampler2D u_shadow;
uniform float u_bias;
uniform float u_soft;
float lit_frac(vec3 lp) {
    if (lp.x < 0.0 || lp.x > 1.0 || lp.y < 0.0 || lp.y > 1.0) return 1.0;
    vec2 ts = 1.0 / vec2(textureSize(u_shadow, 0));
    float s = 0.0;
    float n = 0.0;
    for (int i = -3; i <= 3; i++) {
        for (int j = -3; j <= 3; j++) {
            vec2 o = vec2(float(i), float(j)) * ts * u_soft;
            float d = texture(u_shadow, lp.xy + o).r;
            float w = 1.0 - length(vec2(i, j)) / 5.0;
            s += (lp.z - u_bias > d ? 1.0 : 0.0) * w;   // lp.z: larger - farther from the sun
            n += w;
        }
    }
    return 1.0 - s / n;
}
"""

FS_GEOM = """
#version 330
uniform sampler2D u_base;
uniform sampler2D u_ao;
uniform int u_has_ao;
uniform int u_player;
uniform int u_alpha_test;
uniform vec3 u_L;
uniform vec3 u_V;
uniform vec3 u_sun;
uniform vec3 u_amb;
uniform float u_clipz;
uniform vec4 u_tint;
uniform vec4 u_keep;      // ox, oy, dx, dy: keep only t = dot(p.xy - o, d) in u_keep_rng (d = 0 - off)
uniform vec2 u_keep_rng;
uniform vec3 u_cut_lo;    // cut out everything inside the box (lo > hi - off)
uniform vec3 u_cut_hi;
bool clipped(vec3 p) {
    if (u_keep.z != 0.0 || u_keep.w != 0.0) {
        float t = dot(p.xy - u_keep.xy, u_keep.zw);
        if (t < u_keep_rng.x || t > u_keep_rng.y) return true;
    }
    if (all(greaterThan(p, u_cut_lo)) && all(lessThan(p, u_cut_hi))) return true;
    return false;
}

uniform float u_minlight;
""" + SHADOW_FN + """
in vec3 v_pos;
in vec3 v_nrm;
in vec2 v_uv0;
in vec2 v_uv1;
in vec3 v_lpos;
layout(location = 0) out vec4 o_color;
layout(location = 1) out vec4 o_mask;
void main() {
    if (v_pos.z > u_clipz || clipped(v_pos)) discard;
    vec4 t = texture(u_base, v_uv0);
    if (u_alpha_test == 1 && t.a < 0.5) discard;
    vec3 N = normalize(v_nrm);
    if (dot(N, u_V) < 0.0) N = -N;
    float diff = max(dot(N, u_L), 0.0);
    float sh = lit_frac(v_lpos);
    float sky = 0.75 + 0.25 * N.z;
    vec3 light = max(u_amb * sky + u_sun * diff * sh, vec3(u_minlight));
    float ao = 1.0;
    if (u_has_ao == 1) ao = texture(u_ao, v_uv1).r;
    vec3 rgb = t.rgb * u_tint.rgb * light * mix(1.0, ao, 0.85);
    float pm = (u_player == 1) ? (1.0 - t.a) : 0.0;
    o_color = vec4(rgb, 1.0);
    o_mask = vec4(pm, 1.0, 0.0, 1.0);
}
"""

FS_DECAL = """
#version 330
uniform sampler2D u_base;
uniform vec3 u_sun;
uniform vec3 u_amb;
uniform vec3 u_L;
uniform vec4 u_clip;     // xmin, ymin, xmax, ymax (cells)
uniform float u_fade;
""" + SHADOW_FN + """
in vec3 v_pos;
in vec3 v_nrm;
in vec2 v_uv0;
in vec2 v_uv1;
in vec3 v_lpos;
layout(location = 0) out vec4 o_color;
layout(location = 1) out vec4 o_mask;
void main() {
    vec4 t = texture(u_base, v_uv0);
    float e = min(min(v_pos.x - u_clip.x, u_clip.z - v_pos.x), min(v_pos.y - u_clip.y, u_clip.w - v_pos.y));
    float k = clamp(e / u_fade, 0.0, 1.0);
    float a = t.a * k;
    if (a <= 0.0) discard;
    float diff = max(u_L.z, 0.0);
    vec3 rgb = t.rgb * (u_amb + u_sun * diff);
    o_color = vec4(rgb * a, a);
    o_mask = vec4(0.0, 0.0, 0.0, a);
}
"""

FS_GROUND = """
#version 330
uniform float u_alpha;
""" + SHADOW_FN + """
in vec3 v_pos;
in vec3 v_nrm;
in vec2 v_uv0;
in vec2 v_uv1;
in vec3 v_lpos;
layout(location = 0) out vec4 o_color;
layout(location = 1) out vec4 o_mask;
void main() {
    float a = (1.0 - lit_frac(v_lpos)) * u_alpha;
    o_color = vec4(0.0, 0.0, 0.0, a);
    o_mask = vec4(0.0, 0.0, 0.0, a);
}
"""

VS_SHADOW = """
#version 330
uniform mat4 u_light;
in vec3 in_pos;
in vec2 in_uv0;
out vec2 v_uv0;
out float v_z;
out float v_gz;
out vec3 v_p;
void main() {
    v_uv0 = in_uv0;
    v_gz = in_pos.z;
    v_p = in_pos;
    vec4 p = u_light * vec4(in_pos, 1.0);
    v_z = p.z;
    gl_Position = p;
}
"""

FS_SHADOW = """
#version 330
uniform sampler2D u_base;
uniform int u_alpha_test;
uniform float u_clipz;
uniform vec4 u_keep;      // ox, oy, dx, dy: keep only t = dot(p.xy - o, d) in u_keep_rng (d = 0 - off)
uniform vec2 u_keep_rng;
uniform vec3 u_cut_lo;    // cut out everything inside the box (lo > hi - off)
uniform vec3 u_cut_hi;
bool clipped(vec3 p) {
    if (u_keep.z != 0.0 || u_keep.w != 0.0) {
        float t = dot(p.xy - u_keep.xy, u_keep.zw);
        if (t < u_keep_rng.x || t > u_keep_rng.y) return true;
    }
    if (all(greaterThan(p, u_cut_lo)) && all(lessThan(p, u_cut_hi))) return true;
    return false;
}
in vec2 v_uv0;
in float v_z;
in float v_gz;
in vec3 v_p;
out vec4 o;
void main() {
    if (v_gz > u_clipz || clipped(v_p)) discard;
    if (u_alpha_test == 1 && texture(u_base, v_uv0).a < 0.5) discard;
    o = vec4(1.0);
}
"""


@dataclass
class Sprite:
    rgba: np.ndarray
    mask: np.ndarray
    ox: int
    oy: int

    @property
    def size(self):
        return self.rgba.shape[1], self.rgba.shape[0]


@dataclass
class Look:
    """Lighting/view parameters."""
    # warmer and lighter than before (1.2, 1.13, 1.0) / (0.52, 0.54, 0.6): the DE picture - V ~ 0.50-0.61, warm (quantum 24)
    sun: tuple = (1.32, 1.18, 0.95)
    amb: tuple = (0.68, 0.63, 0.55)
    shadow_alpha: float = 0.42
    soft: float = 1.3             # the shadow blur radius (in map texels)
    saturation: float = 1.08
    contrast: float = 1.04


class Renderer:
    def __init__(self, ss=3, shadow_res=2048):
        import moderngl
        self.mgl = moderngl
        self.ctx = moderngl.create_standalone_context()
        self.ss = ss
        self.shadow_res = shadow_res
        c = self.ctx
        self.p_geom = c.program(vertex_shader=VS, fragment_shader=FS_GEOM)
        self.p_decal = c.program(vertex_shader=VS, fragment_shader=FS_DECAL)
        self.p_ground = c.program(vertex_shader=VS, fragment_shader=FS_GROUND)
        self.p_shadow = c.program(vertex_shader=VS_SHADOW, fragment_shader=FS_SHADOW)
        self._tex = {}
        white = np.full((4, 4, 4), 255, np.uint8)
        self.white = self._mk_tex(white)
        self.sh_depth = c.depth_texture((shadow_res, shadow_res))
        self.sh_depth.compare_func = ''
        self.sh_depth.filter = (moderngl.NEAREST, moderngl.NEAREST)
        self.sh_color = c.renderbuffer((shadow_res, shadow_res), 4)
        self.sh_fbo = c.framebuffer(color_attachments=[self.sh_color], depth_attachment=self.sh_depth)

    # ------------------------------------------------------------ textures
    def _mk_tex(self, a):
        h, w = a.shape[:2]
        t = self.ctx.texture((w, h), 4, np.ascontiguousarray(a).tobytes())
        t.build_mipmaps()
        t.filter = (self.mgl.LINEAR_MIPMAP_LINEAR, self.mgl.LINEAR)
        t.anisotropy = 8.0
        t.repeat_x = t.repeat_y = True
        return t

    def texture(self, rel):
        if not rel:
            return None
        if rel not in self._tex:
            a = assets.texture(rel)
            self._tex[rel] = self._mk_tex(a) if a is not None else None
        return self._tex[rel]

    # ------------------------------------------------------------ geometry
    @staticmethod
    def build_items(parts, place, tint_fn=None):
        """Parts -> a list of dicts with arrays in ground coordinates (cells)."""
        items = []
        for p in parts:
            M = place @ p.matrix
            tint = tint_fn(p) if tint_fn else (1.0, 1.0, 1.0, 1.0)
            if p.is_decal:
                d = p.decal
                w, dp = d['width'] / 2, d['depth'] / 2
                ox, oz = d['offsetx'], d['offsetz']
                q = np.array([[-w + ox, -dp + oz, 0], [w + ox, -dp + oz, 0], [w + ox, dp + oz, 0],
                              [-w + ox, -dp + oz, 0], [w + ox, dp + oz, 0], [-w + ox, dp + oz, 0]], np.float64)
                uv = np.array([[0, 1], [1, 1], [1, 0], [0, 1], [1, 0], [0, 0]], np.float32)
                pos = (np.c_[q, np.ones(6)] @ M.T)[:, :3]
                pos[:, 2] = 0.004
                items.append(dict(kind='decal', pos=pos.astype(np.float32),
                                  nrm=np.tile([0, 0, 1], (6, 1)).astype(np.float32), uv0=uv, uv1=uv,
                                  base=p.textures.get('baseTex'), ao=None, part=p, tint=tint))
                continue
            m = p.geom if p.geom is not None else assets.mesh(p.mesh)
            if m is None:
                continue
            pos = (np.c_[m['pos'], np.ones(len(m['pos']))] @ M.T)[:, :3]
            R = M[:3, :3]
            nrm = m['nrm'] @ np.linalg.inv(R)
            nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-9)
            if np.linalg.det(R) < 0:
                pos = pos.reshape(-1, 3, 3)[:, ::-1].reshape(-1, 3)
                nrm = nrm.reshape(-1, 3, 3)[:, ::-1].reshape(-1, 3)
                uv0 = m['uv0'].reshape(-1, 3, 2)[:, ::-1].reshape(-1, 2)
                uv1 = m['uv1'].reshape(-1, 3, 2)[:, ::-1].reshape(-1, 2)
            else:
                uv0, uv1 = m['uv0'], m['uv1']
            uv0 = uv0.copy()
            uv1 = uv1.copy()
            uv0[:, 1] = 1.0 - uv0[:, 1]
            uv1[:, 1] = 1.0 - uv1[:, 1]
            items.append(dict(kind='mesh', pos=pos.astype(np.float32), nrm=nrm.astype(np.float32),
                              uv0=uv0.astype(np.float32), uv1=uv1.astype(np.float32),
                              base=p.textures.get('baseTex'), ao=p.textures.get('aoTex'), part=p, tint=tint))
        return items

    def _vao(self, prog, it, with_all=True):
        c = self.ctx
        data = np.concatenate([it['pos'], it['nrm'], it['uv0'], it['uv1']], axis=1).astype('f4')
        vbo = c.buffer(data.tobytes())
        names = ['in_pos', 'in_nrm', 'in_uv0', 'in_uv1']
        fmt = '3f 3f 2f 2f'
        present = [n for n in names if n in prog]
        # assembling the format skipping unused attributes
        parts = []
        for n, f in zip(names, ['3f', '3f', '2f', '2f']):
            parts.append(f if n in present else f.replace('f', 'x4').replace('3x4', '12x').replace('2x4', '8x'))
        fmt = ' '.join(parts)
        return c.vertex_array(prog, [(vbo, fmt, *present)]), vbo

    # ------------------------------------------------------------ render
    def render(self, items, footprint=None, clip_z=1e9, look=None, ground=True, decal_clip=None,
               shadow_scale=1.0, pad=2, crop=True):
        """items - from build_items; footprint - (w, h) of the base in cells (for the box/frame).
        clip_z - a cut by height (construction). decal_clip - (x0, y0, x1, y1) cells: decals are clipped by them."""
        look = look or Look()
        c = self.ctx
        mgl = self.mgl
        geo = [it for it in items if it['kind'] == 'mesh']
        dec = [it for it in items if it['kind'] == 'decal']
        for it in geo:
            it.setdefault('clipz', clip_z)
        pl = [it['pos'][it['pos'][:, 2] <= it['clipz'] + 1e-3] for it in geo]
        pl = [x for x in pl if len(x)]
        allp = np.concatenate(pl) if pl else np.zeros((1, 3))
        above = allp[allp[:, 2] >= -0.02]
        if not len(above):
            above = allp
        L = camera.SUN
        shp = camera.shadow_on_ground(above, L)
        pts = [above, shp]
        fw, fh = footprint or (0, 0)
        pts.append(np.array([[0, 0, 0], [fw, 0, 0], [fw, fh, 0], [0, fh, 0]], np.float64))
        if dec and decal_clip:
            x0, y0, x1, y1 = decal_clip
            pts.append(np.array([[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]], np.float64))
        P = np.concatenate(pts)
        scr = camera.project(P)
        left = np.floor(scr[:, 0].min()) - pad
        top = np.floor(scr[:, 1].min()) - pad
        right = np.ceil(scr[:, 0].max()) + pad
        bottom = np.ceil(scr[:, 1].max()) + pad
        W, H = int(right - left), int(bottom - top)
        ss = self.ss
        SW, SH = W * ss, H * ss
        # ---- the view matrix: ground -> NDC
        g = np.concatenate([allp[:, :2], shp[:, :2], P[:, :2]])
        # underground parts project lower on the screen - the ground must cover them with a margin
        mg = 1.0 + max(0.0, -float(allp[:, 2].min())) * 1.5
        gx0, gy0 = g.min(0) - mg
        gx1, gy1 = g.max(0) + mg
        gq = np.array([[gx0, gy0, 0], [gx1, gy0, 0], [gx1, gy1, 0], [gx0, gy1, 0]], np.float64)
        dep = camera.view_depth(np.concatenate([allp, P, gq]))     # the ground plane is entirely inside the depth
        dmin, dmax = dep.min() - 1.0, dep.max() + 1.0
        V = camera.VIEW
        view = np.zeros((4, 4))
        view[0, :3] = [camera.HW, -camera.HW, 0]
        view[0, 3] = -left
        view[1, :3] = [camera.HH, camera.HH, -camera.ZK]
        view[1, 3] = -top
        view[0] *= 2.0 / W
        view[0, 3] -= 1.0
        view[1] *= -2.0 / H
        view[1, 3] += 1.0
        view[2, :3] = -2.0 * V / (dmax - dmin)
        view[2, 3] = 1.0 + 2.0 * dmin / (dmax - dmin)
        view[3, 3] = 1.0
        # ---- the light matrix
        r, u, Ld = camera.light_basis(L)
        gpts = np.concatenate([allp, shp])
        lx, ly, lz = gpts @ r, gpts @ u, gpts @ Ld
        m = 0.05
        lx0, lx1 = lx.min() - m, lx.max() + m
        ly0, ly1 = ly.min() - m, ly.max() + m
        lz0, lz1 = lz.min() - 1, lz.max() + 1
        light = np.zeros((4, 4))
        light[0, :3] = r * 2 / (lx1 - lx0)
        light[0, 3] = -(lx1 + lx0) / (lx1 - lx0)
        light[1, :3] = u * 2 / (ly1 - ly0)
        light[1, 3] = -(ly1 + ly0) / (ly1 - ly0)
        light[2, :3] = -Ld * 2 / (lz1 - lz0)          # closer to the sun -> less depth
        light[2, 3] = (lz1 + lz0) / (lz1 - lz0)
        light[3, 3] = 1
        texel = max(lx1 - lx0, ly1 - ly0) / self.shadow_res
        bias = 2.5 * texel / (lz1 - lz0) * 2 + 0.0015
        vaos = []
        try:
            # ---- the shadow pass
            self.sh_fbo.use()
            c.viewport = (0, 0, self.shadow_res, self.shadow_res)
            self.sh_fbo.clear(depth=1.0)
            c.enable(mgl.DEPTH_TEST)
            c.disable(mgl.BLEND)
            c.disable(mgl.CULL_FACE)
            ps = self.p_shadow
            ps['u_light'].write(light.T.astype('f4').tobytes())
            for it in geo:
                if 'u_clipz' in ps:
                    ps['u_clipz'].value = float(it['clipz'])
                _clip_uniforms(ps, it)
                va, vb = self._vao(ps, it)
                vaos.append((va, vb))
                t = self.texture(it['base']) or self.white
                t.use(0)
                if 'u_base' in ps:
                    ps['u_base'].value = 0
                ps['u_alpha_test'].value = int(it['part'].alpha_test)
                va.render()
            # ---- the main pass
            col = c.texture((SW, SH), 4)
            msk = c.texture((SW, SH), 4)
            dep_rb = c.depth_renderbuffer((SW, SH))
            fbo = c.framebuffer(color_attachments=[col, msk], depth_attachment=dep_rb)
            fbo.use()
            c.viewport = (0, 0, SW, SH)
            fbo.clear(0, 0, 0, 0, depth=1.0)
            c.enable(mgl.BLEND)
            c.blend_func = (mgl.ONE, mgl.ONE_MINUS_SRC_ALPHA)
            self.sh_depth.use(1)
            vt = view.T.astype('f4').tobytes()
            lt = light.T.astype('f4').tobytes()

            def common(p):
                p['u_view'].write(vt)
                p['u_light'].write(lt)
                for k, v in (('u_shadow', 1), ('u_bias', bias), ('u_soft', look.soft * max(1.0, 2048 / self.shadow_res))):
                    if k in p:
                        p[k].value = v
                for k, v in (('u_L', tuple(L)), ('u_V', tuple(V)), ('u_sun', look.sun), ('u_amb', look.amb)):
                    if k in p:
                        p[k].value = v

            # decals
            if dec:
                c.disable(mgl.DEPTH_TEST)
                pd = self.p_decal
                common(pd)
                cl = decal_clip or (-1e3, -1e3, 1e3, 1e3)
                pd['u_clip'].value = tuple(float(x) for x in cl)
                pd['u_fade'].value = 0.35
                for it in dec:
                    t = self.texture(it['base'])
                    if t is None:
                        continue
                    va, vb = self._vao(pd, it)
                    vaos.append((va, vb))
                    t.use(0)
                    pd['u_base'].value = 0
                    va.render()
            # the ground with a shadow (writes depth - hides underground parts)
            c.enable(mgl.DEPTH_TEST)
            if ground:
                z = -0.006
                q = np.array([[gx0, gy0, z], [gx1, gy0, z], [gx1, gy1, z], [gx0, gy0, z], [gx1, gy1, z],
                              [gx0, gy1, z]], np.float32)
                git = dict(pos=q, nrm=np.tile([0, 0, 1], (6, 1)).astype('f4'), uv0=np.zeros((6, 2), 'f4'),
                           uv1=np.zeros((6, 2), 'f4'))
                pg = self.p_ground
                common(pg)
                pg['u_alpha'].value = look.shadow_alpha * shadow_scale
                va, vb = self._vao(pg, git)
                vaos.append((va, vb))
                va.render()
            # geometry
            pgm = self.p_geom
            common(pgm)
            for it in geo:
                pgm['u_clipz'].value = float(it['clipz'])
                _clip_uniforms(pgm, it)
                t = self.texture(it['base']) or self.white
                t.use(0)
                pgm['u_base'].value = 0
                ao = self.texture(it['ao']) if it['ao'] else None
                if ao is not None:
                    ao.use(2)
                    pgm['u_ao'].value = 2
                pgm['u_has_ao'].value = int(ao is not None)
                pgm['u_player'].value = int(it['part'].player)
                pgm['u_alpha_test'].value = int(it['part'].alpha_test)
                pgm['u_tint'].value = tuple(it.get('tint') or (1, 1, 1, 1))
                # 'bright' - a part without deep shadows (player-color flags must read from any side)
                pgm['u_minlight'].value = 0.95 if 'bright' in it['part'].tags else 0.0
                va, vb = self._vao(pgm, it)
                vaos.append((va, vb))
                va.render()
            c.finish()
            rgba = np.frombuffer(col.read(), np.uint8).reshape(SH, SW, 4)[::-1].astype(np.float32)
            mk = np.frombuffer(msk.read(), np.uint8).reshape(SH, SW, 4)[::-1].astype(np.float32)
            fbo.release()
            col.release()
            msk.release()
            dep_rb.release()
        finally:
            for va, vb in vaos:
                va.release()
                vb.release()
        # ---- reduction (a box filter), premultiplied -> straight alpha
        rgba = rgba.reshape(H, ss, W, ss, 4).mean(axis=(1, 3))
        mk = mk.reshape(H, ss, W, ss, 4).mean(axis=(1, 3))
        a = rgba[..., 3:4]
        rgb = np.where(a > 0.5, rgba[..., :3] * 255.0 / np.maximum(a, 1e-3), 0)
        rgb = _grade(rgb, look)
        geomcov = mk[..., 1]
        mask = np.where(geomcov > 1, mk[..., 0] * 255.0 / np.maximum(geomcov, 1e-3), 0)
        out = np.concatenate([np.clip(rgb, 0, 255), a], axis=2).round().astype(np.uint8)
        mask = np.clip(mask, 0, 255).round().astype(np.uint8)
        ox, oy = int(round(-left)), int(round(-top))
        if crop:
            ys, xs = np.nonzero(out[..., 3] > 3)
            if len(xs):
                x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
                out = out[y0:y1, x0:x1]
                mask = mask[y0:y1, x0:x1]
                ox -= x0
                oy -= y0
        return Sprite(out, mask, ox, oy)


def _clip_uniforms(p, it):
    """A part's clips: 'keep' = (ox, oy, dx, dy, a, b) - a strip along a direction; 'cut' = (lo, hi) - a box."""
    k = it.get('keep')
    if k is None:
        p['u_keep'].value = (0.0, 0.0, 0.0, 0.0)
        p['u_keep_rng'].value = (-1e9, 1e9)
    else:
        p['u_keep'].value = tuple(float(x) for x in k[:4])
        p['u_keep_rng'].value = (float(k[4]), float(k[5]))
    c = it.get('cut')
    if c is None:
        p['u_cut_lo'].value = (1.0, 1.0, 1.0)
        p['u_cut_hi'].value = (-1.0, -1.0, -1.0)
    else:
        p['u_cut_lo'].value = tuple(float(x) for x in c[0])
        p['u_cut_hi'].value = tuple(float(x) for x in c[1])


def _grade(rgb, look):
    """A light "pre-render" color correction: saturation and contrast."""
    if look.saturation == 1 and look.contrast == 1:
        return rgb
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    rgb = lum[..., None] + (rgb - lum[..., None]) * look.saturation
    rgb = (rgb - 128.0) * look.contrast + 128.0
    return rgb
