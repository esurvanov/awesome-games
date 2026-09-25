#!/usr/bin/env python3
"""Localization check (assets/locale/*.json):
  1) all keys referenced by code (game/*.py) and the data.py tables are in en.json;
  2) every language has every key of en.json (and no extra ones);
  3) suspiciously untranslated strings - identical to the English ones (except numbers and known names);
  4) --screens: draw the main screens windowless in every language and make sure the captions
     were not truncated (uiskin.OVERFLOW is empty); --out <folder> - save screenshots.

  .venv/bin/python tools/i18n_check.py [--screens] [--out shots/i18n] [--langs en,ru,zh-CN]
"""
import argparse
import glob
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
sys.path.insert(0, ROOT)
LOCALE = os.path.join(ROOT, 'assets', 'locale')

NS = ('app', 'res', 'color', 'player', 'age', 'diff', 'node', 'animal', 'unit', 'building', 'tech', 'civ', 'civui',
      'map', 'match', 'keys', 'key', 'settings', 'menu', 'news', 'learn', 'common', 'lobby', 'hud', 'help', 'job',
      'bonus', 'win', 'score', 'taunt', 'reply', 'rel', 'gm', 'confirm', 'tip', 'stats', 'load', 'obj', 'end',
      'saves', 'msg', 'ctl', 'def', 'eco', 'naval', 'relic')
LITERAL = re.compile(r"'((?:%s)\.[A-Za-z0-9_][A-Za-z0-9_.]*[A-Za-z0-9_])'" % '|'.join(NS))
# keys for which identity with English is normal (proper names, abbreviations, numbers)
SAME_OK = re.compile(r'^(tech\.[a-z_]+\.icon|stats\.team_short|stats\.min_short|hud\.fps|match\.minutes|'
                     r'settings\.(every_\d+)|app\.title|match\.val\.size\.[a-z]+|.*\.(chu_ko_nu|samurai|mangudai|'
                     r'cataphract|mameluke|janissary|berserk|huskarl|paladin|hussar|conquistador|kataparuto|yasama|'
                     r'kamandaran|logistica|furor_celtica|berserkergang|bimaristan|sipahi|mahouts|yeomen|'
                     r'galleon|onager|mangonel|scorpion|trebuchet|halberdier|pikeman|cavalier|arbalester|monk|'
                     r'gate|dock|castle|keep|farm|mill|market|house|stable|arson|nomads|drill|guilds|caravan|'
                     r'ironclad|rocketry|inquisition|supremacy|artillery|coinage|chivalry|anarchy|perfusion|'
                     r'chieftains|architecture|ballistics|redemption|atonement|sanctity|fervor|illumination|'
                     r'careening|shipwright|gillnets|bracer|fletching|forging|masonry|stronghold|zealotry|'
                     r'warwolf|great_wall|crenellations|greek_fire|bearded_axe|throwing_axeman|longbowman|'
                     r'war_elephant|woad_raider|teutonic_knight|elite_[a-z_]+|franks|goths|celts|turks|vikings|'
                     r'persians|saracens|mongols|britons|byzantines|chinese|japanese|spanish|teutons|random|'
                     r'default)\.name)$')


def load(code):
    with open(os.path.join(LOCALE, code + '.json'), encoding='utf-8') as f:
        return json.load(f)


def code_keys():
    """The keys referenced by code: literals + dynamic templates + the data.py tables."""
    keys = set()
    for f in glob.glob(os.path.join(ROOT, 'game', '*.py')) + glob.glob(os.path.join(ROOT, 'game', 'content', '*.py')):
        src = open(f, encoding='utf-8').read()
        keys |= set(LITERAL.findall(src))
    keys.discard('settings.json')
    from game import data, maps, match, keymap, i18n, hud, hud_windows, screens, controls, controls_draw, menu  # noqa
    for k in data.UNITS:
        keys |= {f'unit.{k}.name', f'unit.{k}.desc'}
    for k in data.BUILDINGS:
        keys |= {f'building.{k}.name', f'building.{k}.desc'}
    for k in data.TECHS:
        keys |= {f'tech.{k}.name', f'tech.{k}.desc'}
    for k, d in data.CIVS.items():
        keys.add(f'civ.{k}.name')
        if k != 'default':
            keys.add(f'civ.{k}.style')
            keys.add(f'civ.{k}.team')
            keys |= {f'civ.{k}.bonus{i + 1}' for i in range(len(d.get('bonus_icons', ())))}
    keys.add('civ.random.name')
    keys |= {f'animal.{k}.name' for k in data.ANIMALS} | {f'node.{k}.name' for k in data.NODE_DEFS}
    keys |= {f'res.{r}' for r in data.RES} | {f'age.{i}' for i in range(4)} | {f'age.short.{i}' for i in (1, 2, 3)}
    keys |= {f'diff.{k}' for k in ('easy', 'normal', 'hard')} | {f'color.{c}' for c in i18n.COLOR_KEYS}
    keys |= {'player.you', 'player.default_name'}
    for k in maps.MAPS:
        keys |= {f'map.{k}.name', f'map.{k}.desc'}
    for k, vals, _ in match.OPTIONS:
        keys.add('match.opt.' + k)
        for v, lbl in (vals or ()):
            if lbl.startswith('match.'):
                keys.add(lbl)
    keys |= {lbl for _, lbl, _ in match.FLAGS} | set(match.AI_LEVELS) | set(keymap.LABEL.values())
    for _, name in controls.ORDER_SLOTS + controls.STANCE_SLOTS + controls.FORM_SLOTS:
        keys |= {'ctl.' + name, 'ctl.' + name + '.desc'}
    keys |= set(controls_draw.MODE_TIPS.values()) | set(hud.BONUS_NAMES.values()) | set(hud.VIL_JOB.values())
    keys |= {k for k, _ in hud.HELP_ROWS if k.startswith('help.')} | {v for _, v in hud.HELP_ROWS}
    keys |= {lbl for _, lbl, _ in hud.GAME_MENU + screens.GAME_MENU + screens.STAT_TABS + hud.TOP_BTNS}
    keys |= set(hud.MM_MODES) | set(screens.CONFIRM.values()) | set(screens.TIPS)
    keys |= set(hud_windows.TAUNTS.values()) | set(hud_windows.ALLY_REPLY) | set(hud_windows.ENEMY_REPLY)
    keys |= set(hud_windows.FLARE_REPLY) | {t for t, _ in hud_windows.TITLES.values()}
    keys |= {lbl for _, lbl, _ in hud_windows.SCORE_COLS}
    keys |= {f'news.{k}.{f}' for k in menu.NEWS_STATIC for f in ('title', 'body')}
    for _, key, n in menu.LEARN_CARDS:
        keys.add(f'learn.{key}.title')
        keys |= {f'learn.{key}.{j + 1}' for j in range(n)}
    keys |= {'rel.' + k for k in ('you', 'ally', 'neutral', 'enemy')} | {'win.tt_' + s for s in ('done', 'ok', 'later', 'ban')}
    keys |= {'load.step1', 'load.step2', 'load.step3', 'load.done', 'settings.on', 'settings.off'}
    return keys


def check_keys(langs):
    from game import i18n
    en = load('en')
    need = code_keys()
    fails = 0
    missing = sorted(need - set(en))
    if missing:
        fails += len(missing)
        print(f'  FAIL en.json: missing {len(missing)} keys from code: ' + ', '.join(missing[:20]))
    else:
        print(f'  ok   en.json covers all {len(need)} code keys ({len(en)} entries)')
    for code, _ in i18n.available():
        if code == 'en' or code not in langs:
            continue
        try:
            d = load(code)
        except (OSError, ValueError) as ex:
            print(f'  FAIL {code}: {ex}')
            fails += 1
            continue
        miss = sorted(set(en) - set(d))
        extra = sorted(set(d) - set(en))
        same = [k for k in en if d.get(k) == en[k] and not SAME_OK.match(k) and not re.fullmatch(r'[\d\s%×+/·\-–—()]*', en[k])]
        bad = [k for k, v in d.items() if not isinstance(v, str) or not v.strip()]
        st = 'ok  ' if not miss and not extra and not bad else 'FAIL'
        fails += len(miss) + len(extra) + len(bad)
        print(f'  {st} {code}: {len(d)} entries' + (f', missing {len(miss)}: {miss[:8]}' if miss else '')
              + (f', extra {len(extra)}: {extra[:8]}' if extra else '') + (f', empty: {bad[:8]}' if bad else '')
              + (f', same as English: {len(same)}' + (f' {same[:6]}' if same else '') if same else ''))
        # substitutions {n} and so on must match
        for k in en:
            if k in d and set(re.findall(r'\{\w+\}', en[k])) != set(re.findall(r'\{\w+\}', d[k])):
                print(f'  FAIL {code}: {k}: substitutions do not match: {en[k]!r} / {d[k]!r}')
                fails += 1
    return fails


# ============================================================ screens
def check_screens(langs, out):
    os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
    os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
    import tempfile
    os.environ['KHRONIKI_HOME'] = tempfile.mkdtemp(prefix='khroniki_i18n_')
    import pygame
    from game import i18n, uiskin
    from game.ui import Game
    if out:
        os.makedirs(out, exist_ok=True)
    g = Game()
    g.state = 'menu'
    fails = 0

    def shot(name):
        if out:
            pygame.image.save(g.screen, os.path.join(out, name + '.png'))

    def render(fn, name):
        uiskin.OVERFLOW.clear()
        g.screen.fill((0, 0, 0))
        fn()
        shot(name)
        cut = list(uiskin.OVERFLOW)
        uiskin.OVERFLOW.clear()
        return cut

    for code in langs:
        i18n.set_language(code, persist=False)
        g.menu_bg = None
        cuts = []
        g.state = 'menu'
        g.menu_screen = 'main'
        cuts += render(g.draw_menu, f'{code}_01_menu')
        g.menu_screen = 'single'
        cuts += render(g.draw_menu, f'{code}_02_single')
        g.menu_screen = 'learn'
        cuts += render(g.draw_menu, f'{code}_03_learn')
        g.menu_screen = 'setup'
        g.picker = None
        g.dropdown = None
        cuts += render(g.draw_menu, f'{code}_04_lobby')
        g.picker = 0
        g.picker_sel = 'franks'
        cuts += render(g.draw_menu, f'{code}_05_picker')
        g.picker = None
        for tab in ('game', 'graphics', 'interface', 'audio', 'keys'):
            g.open_settings(back='main', tab=tab)
            cuts += render(g.draw_menu, f'{code}_06_settings_{tab}')
        g.close_settings()
        g.menu_screen = 'main'
        # match: the panel, tooltips, help, menu, windows
        g.begin_loading(dict(diff=1, opponents=2, map_type='arabia', civs=['franks', 'britons', 'mongols'],
                             teams=[0, 1, 1], colors=None, levels=[None, 2, 2], settings=None))
        cuts += render(lambda: g.loading_frame(fast=True), f'{code}_07_loading')
        g.finish_loading()
        w = g.world
        g.help = False
        vil = next(u for u in w.units if u.owner == 0 and u.kind == 'villager')
        tc = next(b for b in w.buildings if b.owner == 0 and b.kind == 'town_center')
        g.center_on(*tc.center())
        g.selected = [vil]
        cuts += render(g.draw, f'{code}_08_hud_villager')
        g.set_build_page('eco')
        cuts += render(g.draw, f'{code}_09_hud_build')
        g.set_build_page(None)
        g.selected = [tc]
        btns = g.get_buttons()
        if btns:
            g._tip = (btns[0]['rect'].center, -100000)
            pygame.mouse.set_pos(btns[0]['rect'].center)
        cuts += render(g.draw, f'{code}_10_hud_tc')
        g.selected = []
        g.help = True
        cuts += render(g.draw, f'{code}_11_help')
        g.help = 'menu'
        cuts += render(g.draw, f'{code}_12_game_menu')
        g.help = 'civ'
        cuts += render(g.draw, f'{code}_13_civ')
        g.help = False
        for win in ('objectives', 'diplomacy', 'techtree', 'chat'):
            g.window = win
            cuts += render(g.draw, f'{code}_14_{win}')
        g.window = None
        g.open_stats()
        for tab in ('score', 'military', 'economy', 'tech', 'society', 'timeline'):
            g.stats_tab = tab
            cuts += render(g.draw_stats, f'{code}_15_stats_{tab}')
        g.state = 'menu'
        g.world = None
        if cuts:
            fails += len(cuts)
            print(f'  FAIL {code}: truncated {len(cuts)} captions: ' +
                  '; '.join(f'{s!r} ({need}>{avail})' for s, need, avail in cuts[:6]))
        else:
            print(f'  ok   {code}: screens without truncated captions')
    return fails


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--screens', action='store_true')
    ap.add_argument('--out', default='')
    ap.add_argument('--langs', default='')
    a = ap.parse_args()
    os.environ.setdefault('KHRONIKI_LANG', 'en')
    from game import i18n
    langs = a.langs.split(',') if a.langs else [c for c, _ in i18n.available()]
    print('== keys')
    fails = check_keys(langs)
    if a.screens:
        print('== screens')
        fails += check_screens(langs, a.out)
    print('FAILS:', fails)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
