"""Windows over the game via the round buttons of the top panel (AoE2 DE): objectives, chat, diplomacy, tech tree;
as well as the player score (F4 above the minimap, the objectives window) and the message history (PgUp).

Windows do not pause the game (as in DE). The layout is procedural, with minimal text.
"""
import random

import pygame

from .data import (SCREEN_W, TOP_H, UNITS, TECHS, BUILDINGS, CIVS, AGE_NAMES, AGE_TECHS, BUILD_MENU, RES_NAME,
                   shade)
from . import civ_ui, i18n, market as mk, scoring, uiskin as S

BOXES = {
    'objectives': pygame.Rect(SCREEN_W // 2 - 360, 80, 720, 470),
    'chat': pygame.Rect(SCREEN_W // 2 - 290, 380, 580, 236),
    'diplomacy': pygame.Rect(SCREEN_W // 2 - 420, 80, 840, 300),
    'techtree': pygame.Rect(20, TOP_H + 16, SCREEN_W - 40, 552),
}
# window headings and captions are locale keys (win.*), see assets/locale/en.json
TITLES = {'objectives': ('hud.objectives', 'victory'), 'chat': ('hud.chat', None),
          'diplomacy': ('hud.diplomacy', 'diplomacy'), 'techtree': ('hud.techtree', 'upgrade')}
SCORE_COLS = [('mil', 'score.military', (200, 60, 50)), ('eco', 'score.economy', (230, 185, 50)),
              ('tech', 'score.technology', (70, 130, 220)), ('soc', 'score.society', (150, 90, 190))]
# own short phrases (number -> key), like DE's "taunts" by number
TAUNTS = {str(i): f'taunt.{i}' for i in range(1, 15)}
ALLY_REPLY = ['reply.ally.%d' % i for i in range(1, 6)]
ENEMY_REPLY = ['reply.enemy.%d' % i for i in range(1, 4)]
FLARE_REPLY = ['reply.flare.%d' % i for i in range(1, 4)]
# tech tree rows: buildings in DE order (military, then economy)
TT_ROWS = ['barracks', 'archery_range', 'stable', 'siege_workshop', 'castle', 'dock', 'monastery', 'blacksmith',
           'university', 'town_center', 'market', 'mill', 'lumber_camp', 'mining_camp']
TT_ICON = 24


def box(name):
    return BOXES[name]


# ============================================================ score
def _short(sc):
    return {'mil': sc['military'], 'eco': sc['economy'], 'tech': sc['technology'], 'soc': sc['society'],
            'total': sc['total']}


def score_of(w, p):
    """The AoE2-style score - one formula for F4, the objectives window and the achievements screen (game/scoring.py)."""
    return _short(scoring.score(w, p.id))


def scores(game):
    """The score of all players, recomputed once per game second."""
    w = game.world
    t, cache = game._score
    if w.time - t >= 1.0 or len(cache) != len(w.players):
        cache = {p.id: _short(sc) for p, sc in zip(w.players, scoring.scores(w))}
        game._score = (w.time, cache)
    return cache


# ============================================================ drawing
def frame(game, name):
    scr = game.screen
    b = BOXES[name]
    S.panel(scr, b, 'stone', ornate=True)
    title, ic = TITLES[name]
    game.title_bar(b, i18n.t(title), ic)
    close = close_rect(name)
    h = close.collidepoint(pygame.mouse.get_pos())
    S.slot(scr, close, 'hover' if h else 'normal')
    for d in (1, -1):
        pygame.draw.line(scr, (230, 90, 70), (close.x + 7, close.centery - 6 * d), (close.right - 7, close.centery + 6 * d), 3)


def close_rect(name):
    b = BOXES[name]
    return pygame.Rect(b.right - 40, b.y + 14, 28, 28)


def draw(game, name):
    frame(game, name)
    {'objectives': draw_objectives, 'chat': draw_chat, 'diplomacy': draw_diplomacy,
     'techtree': draw_techtree}[name](game)


def click(game, name, pos):
    if close_rect(name).collidepoint(pos):
        game.window = None
        return
    fn = {'chat': click_chat, 'diplomacy': click_diplomacy, 'techtree': click_techtree}.get(name)
    if fn:
        fn(game, pos)


# ---- objectives
def draw_objectives(game):
    scr = game.screen
    w = game.world
    b = BOXES['objectives']
    p = w.players[0]
    x0, y = b.x + 30, b.y + 64
    # victory condition
    row = pygame.Rect(x0, y, b.w - 60, 40)
    S.panel(scr, row, 'parchment', frame=False)
    cb = pygame.Rect(row.x + 10, row.centery - 10, 20, 20)
    pygame.draw.rect(scr, (60, 40, 20), cb, 2)
    if w.winner is not None and w.human_won():
        pygame.draw.lines(scr, (40, 120, 40), False, [(cb.x + 4, cb.centery), (cb.centerx - 1, cb.bottom - 4),
                                                      (cb.right - 3, cb.y + 3)], 3)
    S.blit_icon(scr, 'victory', (cb.right + 20, row.centery), 26)
    S.text_fit(scr, i18n.t('win.conquest_goal'), (cb.right + 40, row.centery), game.fonts['b'],
               S.INK, anchor='midleft', shadow=None, max_w=row.right - cb.right - 120)
    t = int(w.time)
    S.text(scr, f'{t // 3600}:{t // 60 % 60:02d}:{t % 60:02d}', (row.right - 12, row.centery), game.fonts['b'],
           S.INK, anchor='midright', shadow=None)
    # players: the score as a bar of 4 parts
    sc = scores(game)
    top = max(1, max(s['total'] for s in sc.values()))
    y += 58
    lx = x0 + 250
    for i, (key, lbl, col) in enumerate(SCORE_COLS):
        pygame.draw.rect(scr, col, (lx + i * 105, y, 12, 12))
        game.text(i18n.t(lbl), (lx + i * 105 + 17, y + 6), 's', S.TEXT_DIM, anchor='midleft')
    y += 24
    for q in sorted(w.players, key=lambda q: (q.team, q.id)):
        s = sc[q.id]
        r = pygame.Rect(x0, y, b.w - 60, 38)
        S.shade_overlay(scr, r, alpha=70)
        pygame.draw.rect(scr, q.color, (r.x, r.y, 6, r.h))
        civ_ui.blit_emblem(game, q.civ, (r.x + 12, r.y + 3, 26, 32))
        game.text(q.name, (r.x + 46, r.y + 4), 'b', shade(q.color, 60) if q.alive else (140, 130, 120))
        game.text(f'{civ_ui.civ_name(q.civ)} · ' + i18n.t('win.team_n', n=q.team + 1), (r.x + 46, r.y + 21), 's',
                  S.TEXT_DIM)
        game.age_shield(r.x + 228, r.centery, q.age, 30, shade(q.color, -50))
        bx, bw = lx, r.right - lx - 70
        xx = bx
        for key, _, col in SCORE_COLS:
            ww = int(bw * s[key] / top)
            if ww:
                pygame.draw.rect(scr, col, (xx, r.y + 11, ww, 16))
                xx += ww
        pygame.draw.rect(scr, (90, 74, 50), (bx, r.y + 10, bw, 18), 1)
        game.text(str(s['total']), (r.right - 8, r.centery), 'b', anchor='midright')
        if not q.alive:
            pygame.draw.line(scr, (230, 90, 70), (r.x + 8, r.centery), (r.right - 8, r.centery), 2)
        y += 44
    # own totals: gathered, killed, units, buildings
    y = b.bottom - 62
    stats = [('economics', int(sum(p.gathered.values()))), ('kill', p.kills),
             ('training', sum(1 for u in w.units if u.owner == 0)),
             ('construction', sum(1 for bb in w.buildings if bb.owner == 0 and bb.complete))]
    tw = (b.w - 60) // len(stats)
    for i, (ic, v) in enumerate(stats):
        r = pygame.Rect(x0 + i * tw, y, tw - 10, 40)
        S.slot(scr, r)
        S.blit_icon(scr, ic, (r.x + 22, r.centery), 28)
        game.text(str(v), (r.x + 44, r.centery), 'b', anchor='midleft')


# ---- diplomacy
def dip_rows(game):
    """[(player, row rectangle, {relation: rect}, {resource: rect})]."""
    w = game.world
    b = BOXES['diplomacy']
    out = []
    y = b.y + 96
    for q in w.players[1:]:
        r = pygame.Rect(b.x + 24, y, b.w - 48, 46)
        st = {k: pygame.Rect(r.x + 250 + i * 86, r.y + 9, 80, 28) for i, k in enumerate(('ally', 'neutral', 'enemy'))}
        tr = {res: pygame.Rect(r.x + 520 + i * 66, r.y + 7, 60, 32) for i, res in enumerate(('wood', 'food', 'gold', 'stone'))}
        out.append((q, r, st, tr))
        y += 54
    return out


def draw_diplomacy(game):
    scr = game.screen
    w = game.world
    b = BOXES['diplomacy']
    p = w.players[0]
    mp = pygame.mouse.get_pos()
    # header: a "teams locked" padlock, tribute (fee %), the market
    hy = b.y + 70
    lock(scr, b.x + 290, hy)
    game.text(i18n.t('win.teams_locked'), (b.x + 304, hy), 's', S.TEXT_DIM, anchor='midleft')
    has_market = mk.has_market(w, 0)
    fee = int(round(mk.tribute_fee(p) * 100))
    game.text(i18n.t('win.tribute_lot', n=mk.LOT) + (' · ' + i18n.t('win.fee', n=fee) if has_market else ''),
              (b.x + 544, hy), 's', S.TEXT_DIM, anchor='midleft')
    if not has_market:
        ic = game.icon('b', 'market', 0, 24)
        scr.blit(ic, (b.right - 150, hy - 12))
        game.text(i18n.t('win.need_market'), (b.right - 122, hy), 's', S.RED, anchor='midleft')
    for q, r, st, tr in dip_rows(game):
        S.shade_overlay(scr, r, alpha=70)
        pygame.draw.rect(scr, q.color, (r.x, r.y, 6, r.h))
        civ_ui.blit_emblem(game, q.civ, (r.x + 12, r.y + 5, 30, 36))
        game.text(q.name, (r.x + 50, r.y + 6), 'b', shade(q.color, 60) if q.alive else (140, 130, 120))
        game.text(civ_ui.civ_name(q.civ), (r.x + 50, r.y + 25), 's', S.TEXT_DIM)
        rel = 'ally' if w.allied(0, q.id) else ('enemy' if w.hostile(0, q.id) else 'neutral')
        for k, rr in st.items():
            on = k == rel
            S.button(scr, rr, 'on' if on else 'disabled')
            col = {'ally': (150, 225, 130), 'neutral': (230, 220, 170), 'enemy': (255, 130, 110)}[k]
            S.text_fit(scr, i18n.t('rel.' + k), rr.center, game.fonts['bs'],
                       col if on else (150, 140, 120), anchor='center', max_w=rr.w - 6)
        can = has_market and q.alive and rel == 'ally'
        for res, rr in tr.items():
            ok = can and p.res[res] >= mk.tribute_cost(p)
            S.slot(scr, rr, 'hover' if ok and rr.collidepoint(mp) else 'normal')
            S.blit_icon(scr, res, (rr.x + 14, rr.centery), 22)
            game.text(f'+{mk.LOT}', (rr.x + 27, rr.centery), 's', (240, 235, 220) if ok else (120, 110, 100),
                      anchor='midleft')
        if not q.alive:
            pygame.draw.line(scr, (230, 90, 70), (r.x + 8, r.centery), (r.right - 8, r.centery), 2)
    for q, r, st, tr in dip_rows(game):
        for res, rr in tr.items():
            if rr.collidepoint(mp):
                game.draw_tip([i18n.t('eco.tribute_to', name=q.name), {res: mk.tribute_cost(p)},
                               f'+{mk.LOT} {RES_NAME[res].lower()}', ('dim', i18n.t('eco.shift_x5'))],
                              anchor=(rr.x, rr.y - 4))


def click_diplomacy(game, pos):
    w = game.world
    p = w.players[0]
    for q, r, st, tr in dip_rows(game):
        for k, rr in st.items():
            if rr.collidepoint(pos):
                w.msg(i18n.t('win.teams_locked'), (230, 210, 160))
                return
        for res, rr in tr.items():
            if rr.collidepoint(pos):
                game.audio.click()
                n = 5 if game.mods() & pygame.KMOD_SHIFT else 1
                if not mk.has_market(w, 0):
                    w.msg(i18n.t('win.tribute_needs_market'), (255, 150, 90))
                elif not w.allied(0, q.id):
                    w.msg(i18n.t('win.tribute_allies_only'), (255, 150, 90))
                elif not sum(1 for _ in range(n) if mk.tribute(w, p, q.id, res)):
                    w.msg(i18n.t('msg.not_enough_resources'), (255, 150, 90))
                return


# ---- chat
def chat_rects():
    b = BOXES['chat']
    return {'all': pygame.Rect(b.x + 20, b.bottom - 46, 110, 30), 'allies': pygame.Rect(b.x + 136, b.bottom - 46, 110, 30),
            'input': pygame.Rect(b.x + 254, b.bottom - 46, b.w - 274, 30)}


def draw_chat(game):
    scr = game.screen
    b = BOXES['chat']
    log = pygame.Rect(b.x + 20, b.y + 58, b.w - 40, b.h - 112)
    S.shade_overlay(scr, log, alpha=120)
    y = log.bottom - 4
    for txt, col in reversed(game.chat_log[-7:]):
        r = game.text(txt, (log.x + 8, y), 'm', col, anchor='bottomleft')
        y = r.y - 1
        if y < log.y + 16:
            break
    if not game.chat_log:
        game.text(i18n.t('win.chat_hint'), (log.centerx, log.centery), 's', S.TEXT_DIM, anchor='center')
    rs = chat_rects()
    for k, lbl in (('all', 'win.chat_all'), ('allies', 'win.chat_allies')):
        S.button(scr, rs[k], 'on' if game.chat_to == k else 'normal')
        S.text_fit(scr, i18n.t(lbl), rs[k].center, game.fonts['bs'], (255, 236, 190), anchor='center',
                   max_w=rs[k].w - 8)
    inp = rs['input']
    pygame.draw.rect(scr, (16, 12, 8), inp)
    pygame.draw.rect(scr, S.GOLD_DK, inp, 1)
    caret = '|' if (pygame.time.get_ticks() // 500) % 2 else ''
    img = game.fonts['m'].render(game.chat_text + caret, True, (250, 245, 230))
    scr.blit(img, (inp.x + 8, inp.centery - img.get_height() // 2), (max(0, img.get_width() - inp.w + 16), 0,
                                                                      inp.w - 16, img.get_height()))


def click_chat(game, pos):
    rs = chat_rects()
    for k in ('all', 'allies'):
        if rs[k].collidepoint(pos):
            game.audio.click()
            game.chat_to = k


def chat_key(game, e):
    k = e.key
    if k == pygame.K_ESCAPE:
        game.window = None
        game.chat_text = ''
    elif k in (pygame.K_RETURN, pygame.K_KP_ENTER):
        send_chat(game, game.chat_text.strip())
        game.chat_text = ''
        game.window = None
    elif k == pygame.K_BACKSPACE:
        game.chat_text = game.chat_text[:-1]
    elif k == pygame.K_TAB:
        game.chat_to = 'allies' if game.chat_to == 'all' else 'all'
    else:
        ch = getattr(e, 'unicode', '')
        if ch and ch.isprintable() and len(game.chat_text) < 80:
            game.chat_text += ch
    return True


def send_chat(game, text):
    """A message from a player: into the log and onto the screen; computer players answer with canned phrases."""
    if not text:
        return
    w = game.world
    p = w.players[0]
    shown = i18n.t(TAUNTS[text]) if text in TAUNTS else text
    to = '' if game.chat_to == 'all' else i18n.t('win.chat_to_allies') + ' '
    col = shade(p.color, 70)
    game.chat_log.append((f'{to}{p.name}: {shown}', col))
    w.msg(f'{to}{p.name}: {shown}', col)
    now = pygame.time.get_ticks()
    delay = 1200
    for q in w.players[1:]:
        if not q.alive or not q.is_ai:
            continue
        ally = w.allied(0, q.id)
        if game.chat_to == 'allies' and not ally:
            continue
        if ally:
            ans = i18n.t(ALLY_REPLY[(len(text) + q.id) % len(ALLY_REPLY)])
        elif random.random() < 0.5:
            ans = i18n.t(ENEMY_REPLY[(len(text) + q.id) % len(ENEMY_REPLY)])
        else:
            continue
        game.chat_replies.append((now + delay, f'{q.name}: {ans}', shade(q.color, 60)))
        delay += 700


# ---- message history (PgUp)
def draw_history(game):
    log = game.chat_log[-14:]
    msgs = [(t, c) for t, _, c in game.world.messages]
    lines = [x for x in (log + [m for m in msgs if m not in log])][-16:]
    if not lines:
        return
    r = pygame.Rect(8, TOP_H + 44, 520, 20 * len(lines) + 12)
    S.shade_overlay(game.screen, r, alpha=150)
    for i, (t, c) in enumerate(lines):
        game.text(t, (r.x + 8, r.y + 6 + i * 20), 'm', c)


# ---- tech tree
def civ_list():
    return sorted((k for k in CIVS if k != 'default'), key=civ_ui.civ_name) or ['default']


def tt_civ(game):
    if game.tt_civ is None:
        game.tt_civ = game.world.players[0].civ
    return game.tt_civ


def tt_items(civ):
    """[(building, [(type, name, age)])] for a civilization: units and techs by building."""
    out = []
    for bk in TT_ROWS:
        d = BUILDINGS.get(bk)
        if not d:
            continue
        its = []
        for u in d.get('trains', []):
            ud = UNITS.get(u)
            if ud and (not ud.get('civ') or ud['civ'] == civ):
                its.append(('u', u, ud.get('age', 0)))
        for t in d.get('techs', []):
            td = TECHS.get(t)
            if td and t not in AGE_TECHS and (not td.get('civ') or td['civ'] == civ):
                its.append(('t', t, td.get('age', 0)))
        out.append((bk, its))
    other = [('b', k, BUILDINGS[k].get('age', 0)) for k in BUILD_MENU
             if k in BUILDINGS and k not in TT_ROWS and not BUILDINGS[k].get('civ')]
    out.append((None, other))
    return out


def tt_layout(game):
    """[(rect, type, name, age, building)] + rows [(y, h, building)] - cached by civilization."""
    civ = tt_civ(game)
    cache = game.__dict__.setdefault('_tt', {})
    if civ in cache:
        return cache[civ]
    b = BOXES['techtree']
    x0 = b.x + 70
    colw = (b.right - 16 - x0) // 4
    per = max(1, (colw - 8) // (TT_ICON + 2))
    y = b.y + 100
    cells, rows = [], []
    for bk, its in tt_items(civ):
        by_age = {a: [] for a in range(4)}
        for typ, nm, age in its:
            by_age[max(0, min(3, age))].append((typ, nm, age))
        lines = max([1] + [(len(v) + per - 1) // per for v in by_age.values()])
        h = lines * (TT_ICON + 2) + 4
        rows.append((y, h, bk))
        for a, lst in by_age.items():
            for i, (typ, nm, age) in enumerate(lst):
                r = pygame.Rect(x0 + a * colw + 4 + (i % per) * (TT_ICON + 2), y + 2 + (i // per) * (TT_ICON + 2),
                                TT_ICON, TT_ICON)
                cells.append((r, typ, nm, age, bk))
        y += h
    cache[civ] = (cells, rows, x0, colw)
    return cache[civ]


def tt_arrows():
    b = BOXES['techtree']
    return pygame.Rect(b.x + 24, b.y + 50, 24, 24), pygame.Rect(b.x + 290, b.y + 50, 24, 24)


def draw_techtree(game):
    scr = game.screen
    w = game.world
    b = BOXES['techtree']
    civ = tt_civ(game)
    own = civ == w.players[0].civ
    p = w.players[0]
    bans = p.banned if own else _bans(civ)
    cells, rows, x0, colw = tt_layout(game)
    mp = pygame.mouse.get_pos()
    # civilization: <- crest name ->
    la, ra = tt_arrows()
    for r, d in ((la, -1), (ra, 1)):
        S.slot(scr, r, 'hover' if r.collidepoint(mp) else 'normal')
        cx, cy = r.center
        pygame.draw.polygon(scr, S.GOLD, [(cx - 5 * d, cy - 7), (cx + 5 * d, cy), (cx - 5 * d, cy + 7)])
    civ_ui.blit_emblem(game, civ, (la.right + 10, la.y - 4, 26, 32))
    game.text(civ_ui.civ_name(civ), (la.right + 50, la.centery), 'b', (255, 228, 160), anchor='midleft')
    # legend
    lx = b.right - 420
    for i, st in enumerate(('done', 'ok', 'later', 'ban')):
        r = pygame.Rect(lx + i * 100, la.y + 4, 16, 16)
        tt_mark(scr, r, st)
        game.text(i18n.t(f'win.tt_{st}'), (r.right + 6, r.centery), 's', S.TEXT_DIM, anchor='midleft')
    # age columns
    for a in range(4):
        cx = x0 + a * colw
        hr = pygame.Rect(cx + 2, b.y + 78, colw - 4, 20)
        S.shade_overlay(scr, hr, alpha=90 if a % 2 else 60)
        game.age_shield(hr.x + 12, hr.centery, a, 20, (110, 40, 30) if (own and a <= p.age) else (70, 60, 50),
                        dim=not (own and a <= p.age))
        game.text(AGE_NAMES[a], (hr.x + 28, hr.centery), 'bs', (250, 214, 130) if (not own or a <= p.age)
                  else S.TEXT_DIM, anchor='midleft')
        if own and a == p.age:
            pygame.draw.rect(scr, S.GOLD, hr, 1)
    # building rows
    for i, (y, h, bk) in enumerate(rows):
        if i % 2 == 0:
            S.shade_overlay(scr, (b.x + 14, y, b.w - 28, h), alpha=45)
        if bk:
            ic = game.icon('b', bk, 0, min(h - 2, 26))
            scr.blit(ic, ic.get_rect(center=(b.x + 42, y + h // 2)))
        else:
            S.blit_icon(scr, 'construction', (b.x + 42, y + h // 2), 24)
    hover = None
    for r, typ, nm, age, bk in cells:
        scr.blit(game.icon(typ, nm, 0, TT_ICON), r)
        if nm in bans or (bk and bk in bans):
            st = 'ban'
        elif own and typ == 't' and nm in p.techs:
            st = 'done'
        elif own and age > p.age:
            st = 'later'
        else:
            st = 'ok'
        tt_mark(scr, r, st)
        if r.collidepoint(mp):
            hover = (r, typ, nm)
            pygame.draw.rect(scr, S.GOLD_HI, r.inflate(2, 2), 1)
    if hover:
        r, typ, nm = hover
        d = (UNITS if typ == 'u' else TECHS if typ == 't' else BUILDINGS)[nm]
        game.draw_tip([d['name'], d.get('cost', {}), d.get('desc', '')], anchor=(r.x, r.y - 4))


def tt_mark(scr, r, st):
    """Icon state: researched - a green frame and a tick; later - dimmed; unavailable - grey with a red cross."""
    if st == 'done':
        pygame.draw.rect(scr, (90, 220, 90), r, 2)
        pygame.draw.lines(scr, (90, 240, 90), False, [(r.right - 10, r.bottom - 7), (r.right - 7, r.bottom - 3),
                                                     (r.right - 2, r.bottom - 11)], 2)
    elif st == 'later':
        S.shade_overlay(scr, r, alpha=110)
        pygame.draw.rect(scr, (90, 74, 50), r, 1)
    elif st == 'ban':
        S.shade_overlay(scr, r, color=(40, 40, 40), alpha=170)
        pygame.draw.line(scr, (220, 50, 40), r.topleft, (r.right - 1, r.bottom - 1), 2)
        pygame.draw.line(scr, (220, 50, 40), (r.right - 1, r.y), (r.x, r.bottom - 1), 2)
    else:
        pygame.draw.rect(scr, (150, 118, 70), r, 1)


_BANS = {}


def _bans(civ):
    if civ not in _BANS:
        from .world import civ_bans
        _BANS[civ] = civ_bans(civ)
    return _BANS[civ]


def click_techtree(game, pos):
    la, ra = tt_arrows()
    for r, d in ((la, -1), (ra, 1)):
        if r.collidepoint(pos):
            game.audio.click()
            lst = civ_list()
            cur = tt_civ(game)
            i = lst.index(cur) if cur in lst else 0
            game.tt_civ = lst[(i + d) % len(lst)]


def lock(scr, cx, cy):
    pygame.draw.rect(scr, (200, 170, 90), (cx - 6, cy - 2, 12, 9), border_radius=2)
    pygame.draw.arc(scr, (200, 170, 90), (cx - 5, cy - 9, 10, 12), 0, 3.1416, 2)

