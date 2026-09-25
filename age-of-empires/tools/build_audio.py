#!/usr/bin/env python3
"""Building the game's sounds from the audio of 0 A.D. (Wildfire Games, CC BY-SA 3.0) -> assets/audio/.

The source is the selective download by tools/fetch_0ad.py (assets/0ad_raw/, not included in git).
The result (included in git, the game works without assets/0ad_raw):
  assets/audio/music/*.opus   - music: loudness leveled (EBU R128, loudnorm), Opus 80 kbit/s
  assets/audio/sfx/<name>/*.opus - effects: silence at the edges trimmed, long ones shortened with a fade,
                                  peak/short-term loudness leveled, some - a pitch shift
  assets/audio/manifest.json  - which files belong to which event + the source, license, per-file authorship

ffmpeg with libopus is needed (brew install ffmpeg). Run: .venv/bin/python tools/build_audio.py
A repeated run rebuilds everything (~1 min)."""
import argparse
import concurrent.futures as cf
import json
import os
import re
import shutil
import subprocess
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'assets', '0ad_raw', 'public', 'audio')
OUT = os.path.join(ROOT, 'assets', 'audio')
UPSTREAM = 'binaries/data/mods/public/audio/'
REPO = 'https://gitea.wildfiregames.com/0ad/0ad'
LICENSE = 'CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/)'
CREDIT = '0 A.D. © Wildfire Games (https://www.wildfiregames.com/)'
SR = 48000

# ============================================================ music
# Pieces suitable for medieval Europe and Asia were chosen; "Greek/Roman" in character ones
# (Forging a City-State, Juno Protect You) and too short/mournful ones are skipped.
MUSIC = {
    'menu': ['Epitaph'],
    'peace': ['Celtica', 'Celtic_Pride', 'Highland_Mist', 'Harvest_Festival', 'Tavern_in_the_Mist',
              'Northern_Frontier', 'Albian_Nocturne', 'Mountain_Idyll', 'Sunrise', 'The_Fledgling_Kingdom',
              "Water's_Edge", 'As_Seasons_Change', 'Midwinter', 'Solstice_Festival', 'Eastern_Dreams',
              'Cisalpine_Gaul', 'The_Road_Ahead'],
    'battle': ['Honor_Bound', 'Tale_of_Warriors', 'Red_Dawn', 'Calm_Before_the_Storm', 'Point_of_No_Return',
               'Harsh_Lands_Rugged_People', 'A_Brothers_Revenge', 'Bandit_Country', 'Taiko_1', 'Taiko_2',
               'Upstart_King'],
    'victory': ['You_are_Victorious!'],
    'defeat': ['Dried_Tears'],
}
MUSIC_LUFS = -20.0            # effects are leveled louder (~-14 dBFS short-term) - the music sits under them
MUSIC_BITRATE = '80k'


# ============================================================ effects
def rng(prefix, nums, fmt='{:02d}'):
    return [prefix + fmt.format(i) + '.ogg' for i in nums]


A = 'attack/weapon/'
I = 'attack/impact/'
D = 'actor/human/death/'
V = 'voice/latin/civ/civ_'
AL = 'interface/alarm/'
CB = 'interface/complete/building/complete_'
SB = 'interface/select/building/sel_'
P = {'pitch': (0.94, 1.06)}   # add variants a little lower and a little higher in pitch

# name -> [path | (path, options)]; options: max (sec), start (sec), pitch (multipliers), gain (dB), stereo
SFX = {
    # ---- combat
    'hit_melee': [(p, P) for p in rng(A + 'swordhit_', (10, 11, 12, 15, 16, 18))]
                 + [(p, P) for p in rng(I + 'shield_metal_', (2, 4, 5, 7))],
    'hit_pierce': [(p, P) for p in rng(I + 'fleshstab_', (1, 2, 3))] + rng(I + 'shield_wood_', (2, 4, 6)),
    'hit_arrow': rng(I + 'arrow_metal_', (1, 2, 3, 4)) + rng(I + 'arrow_wood_', (1, 2, 3))
                 + [(p, P) for p in rng(I + 'fleshimp_', (10, 11, 12))],
    'hit_shot': rng(I + 'sling_metal_', (1, 2, 3, 4)) + rng(I + 'sling_wood_', (1, 2)),
    'hit_bld': rng(I + 'arrow_stone_', (1, 2, 3, 4)) + rng(I + 'shield_wood_', (5, 7)),
    'hit_thud': [(p, P) for p in rng(I + 'fleshimp_', (10, 11, 12))] + [I + 'shield_wood_08.ogg'],
    'hit_siege': [(p, {'max': 2.2}) for p in rng(I + 'siegeprojectilehit_', (1, 2, 3, 4))],
    'hit_ram': [('attack/siege/ram_attack.ogg', {'max': 1.6, 'pitch': (0.9, 1.08)})],
    'arrow': [(p, {'max': 1.2}) for p in rng(A + 'bow_attack_', (1, 2, 3, 4, 5, 6))],
    'arrow_jav': rng(A + 'jav_attack_', (1, 2, 3, 4)),
    'arrow_gun': [(A + f'Musket_{i}.ogg', {'max': 1.4}) for i in (1, 2, 3)],
    'fire_siege': [('attack/siege/onager_shooting_11.ogg', {'pitch': (0.9, 1.1)}),
                   ('attack/siege/ballist_attack_01.ogg', {'max': 1.4})],
    'fire_bolt': [('attack/siege/ballist_attack_01.ogg', {'max': 1.4}),
                  ('attack/siege/ballist_attack_02.ogg', {'max': 1.4})],
    'fire_cannon': [(A + f'Musket_{i}.ogg', {'max': 2.0, 'pitch': (0.62,), 'only_pitched': True}) for i in (1, 2, 3)],
    'blast': [(p, {'max': 2.2, 'pitch': (0.92,)}) for p in rng(I + 'siegeprojectilehit_', (1, 2, 3, 4))],
    'explode': [('attack/destruction/explode_debris_20.ogg', {'max': 3.5})],
    'destroy': [('attack/destruction/building_collapse_large_01.ogg', {'max': 4.0}),
                ('attack/destruction/building_collapse_large_02.ogg', {'max': 4.0})],
    'death': rng(D + 'male_death_', (1, 2, 4, 5, 6, 7, 8, 9)) + rng(D + 'death_', (11, 13, 14, 16, 17)),
    'death_female': rng(D + 'female_death_', (1, 2, 3, 6, 8, 9)),
    'death_horse': rng('actor/fauna/death/death_horse_', (10, 11, 12, 13)),
    'death_camel': ['actor/fauna/death/death_camel_10.ogg'],
    'death_elephant': ['actor/fauna/animal/elephant_death1.ogg', 'actor/fauna/animal/elephant_death2.ogg'],
    'death_animal': rng('actor/fauna/death/Animal_death_generic_', (10, 12, 13)),
    'death_boar': [('actor/fauna/animal/pig_death.ogg', {'max': 1.4})],
    'baa': rng('actor/fauna/death/goat_', (10, 13, 14, 15)),
    'death_ship': [('actor/ship/warship_death_01.ogg', {'max': 3.0}),
                   ('actor/ship/warship_death_02.ogg', {'max': 3.0})],
    # ---- economy
    'work_chop': rng('resource/lumbering/lumber_tree_', range(1, 10)),
    'work_mine': rng('resource/mining/mine_stone_', (1, 2, 4, 5, 6, 9)) + rng('resource/mining/mine_metal_', (2, 3, 4, 7)),
    'work_farm': rng('resource/farming/hoe_', (10, 12, 14, 15, 16, 17), '{:d}')
                 + rng('resource/gathering/gather_field_', (1, 5, 6)),
    'work_forage': rng('resource/gathering/gather_fruit_', (1, 3, 4, 5, 6, 8, 11, 12)),
    'work_butcher': [(p, {'max': 1.4}) for p in rng('resource/gathering/gather_meat_', (1, 2, 4, 6, 8))],
    'work_fish': [('ambient/water/wave_21.ogg', {'start': s, 'max': 1.3, 'fade_in': 0.15}) for s in (2.0, 9.5, 17.0)],
    'work_build': rng('resource/construction/con_wood_', (1, 2, 3, 4, 6, 7, 8))
                  + rng('resource/construction/con_stone_', (1, 3))
                  + [('resource/construction/con_saw_05.ogg', {})],
    'place': rng('resource/construction/con_stone_', (2, 4)),
    'reseed': ['resource/farming/hoe_11.ogg', 'resource/farming/hoe_13.ogg'],
    # ---- notifications (global)
    'train_inf': [AL + 'alarmcreatemiltaryfoot_1.ogg'],
    'train_cav': [AL + 'alarmcreatecavalry_1.ogg'],
    'train_vil': [AL + 'alarmcreateworker_1.ogg', AL + 'alarmcreatefemale.ogg'],
    'train_monk': [AL + 'alarmcreatepriest_1.ogg'],
    'train_ship': [AL + 'alarm_warship_03.ogg'],
    'tech_done': [AL + 'alarmresearchtech_1.ogg'],
    'upgrade': [AL + 'alarmupgradearmory_1.ogg'],
    'age_up': [AL + 'alarmresearchphase_1.ogg'],
    'age_other': [(AL + 'alarmresearchphase_1.ogg', {'pitch': (0.89,), 'only_pitched': True, 'gain': -4})],
    'alert': [AL + 'alarmattackplayer_1.ogg', AL + 'alarmattackunit_1.ogg'],
    'alert_city': [AL + 'alarmattackcity_1.ogg'],
    'bell': [AL + 'alarmalert0.ogg', AL + 'alarmalert2.ogg'],
    'victory': [AL + 'alarmvictory_1.ogg'],
    'defeat': [AL + 'alarmdefeat_1.ogg'],
    'defeat_other': [AL + 'alarmalert1.ogg'],
    'defeat_ally': [AL + 'alarm_defeated_ally.ogg'],
    'convert': [AL + 'alarmunitturn_1.ogg'],
    'convert_start': [SB + 'temple_10.ogg', SB + 'temple.ogg'],
    # ---- buildings: done / selection
    **{'done_' + k: [CB + v + '.ogg'] for k, v in (
        ('town_center', 'civ_center'), ('house', 'house'), ('mill', 'farmstead'), ('camp', 'storehouse'),
        ('farm', 'field'), ('barracks', 'barracks'), ('archery_range', 'range'), ('stable', 'stable'),
        ('blacksmith', 'forge'), ('tower', 'tower'), ('siege_workshop', 'universal'), ('castle', 'fortress'),
        ('monastery', 'temple'), ('university', 'library'), ('market', 'market'), ('dock', 'dock'),
        ('wall', 'wall'), ('gate', 'gate'))},
    **{'selb_' + k: [SB + v + '.ogg'] for k, v in (
        ('town_center', 'civ_center'), ('house', 'house'), ('mill', 'farmstead'), ('camp', 'storehouse'),
        ('farm', 'field'), ('barracks', 'barracks'), ('stable', 'stable'), ('blacksmith', 'forge'),
        ('tower', 'tower'), ('siege_workshop', 'universal_1'), ('castle', 'fortress'), ('monastery', 'temple'),
        ('university', 'library'), ('market', 'market'), ('dock', 'dock'), ('wall', 'wall'), ('gate', 'gate'))},
    'sel_tree': ['interface/select/resource/sel_tree_01.ogg'],
    'sel_stone': ['interface/select/resource/sel_stone_02.ogg'],
    'sel_gold': ['interface/select/resource/sel_metal_01.ogg'],
    'sel_berries': [('interface/select/resource/sel_fruit_02.ogg', {'max': 1.2})],
    # ---- garrison, trade, navy, siege
    'garrison': [('actor/gate/stonegate_close_21.ogg', {'max': 1.6}), ('actor/gate/stonegate_close_22.ogg', {'max': 1.6})],
    'eject': [('actor/gate/stonegate_open_21.ogg', {'max': 1.8}), ('actor/gate/stonegate_open_22.ogg', {'max': 1.8})],
    'market': [(SB + 'market.ogg', {'pitch': (0.95, 1.05)})],
    'tribute': [(SB + 'market.ogg', {'pitch': (0.85,), 'only_pitched': True})],
    'trade': [(SB + 'market.ogg', {'pitch': (0.9,), 'gain': -3})],
    'pack': ['attack/siege/onager_moving_11.ogg', 'attack/siege/ram_move.ogg'],
    'board': [('actor/ship/warship_move_01.ogg', {'max': 1.2}), ('actor/ship/ship_select_01.ogg', {})],
    'unload': [('actor/ship/smove_21.ogg', {'max': 1.5}), ('actor/ship/ship_move.ogg', {'max': 1.5})],
    'click': ['interface/ui/rally_click_01.ogg', 'interface/ui/rally_click_02.ogg'],
    # ---- voices: Latin (0 A.D., CC BY-SA) - an ancient language, brief; animals and machines - no speech
    'sel_vil_m': [V + f'male_{w}_1.ogg' for w in ('hello', 'what_is_it', 'my_lord')],
    'sel_vil_f': [V + f'female_{w}_1.ogg' for w in ('hello', 'what_is_it', 'my_lord')],
    'sel_mil': [V + f'male_{w}_1.ogg' for w in ('what_is_it', 'my_lord', 'hello')],
    'sel_cav': ['actor/fauna/animal/horse_select1.ogg', 'actor/fauna/animal/horse_select2.ogg',
                'actor/fauna/animal/horse_select3.ogg'],
    'sel_camel': ['actor/fauna/animal/camel_10.ogg'],
    'sel_elephant': ['actor/fauna/animal/elephant_select1.ogg', 'actor/fauna/animal/elephant_select2.ogg'],
    'sel_siege': ['attack/siege/siege_select_10.ogg'],
    'sel_ship': ['actor/ship/ship_select_01.ogg'],
    'sel_sheep': ['actor/fauna/animal/sheep_10.ogg', 'actor/fauna/animal/sheep_11.ogg'],
    'sel_boar': ['actor/fauna/animal/pig_10.ogg', 'actor/fauna/animal/pig_12.ogg'],
    'cmd_move_m': [V + 'male_walk_1.ogg', V + 'male_march_1.ogg'],
    'cmd_move_f': [V + 'female_walk_1.ogg'],
    'cmd_attack_m': [V + f'male_{w}_1.ogg' for w in ('attack', 'go_out_against', 'fight')],
    'cmd_attack_f': [V + 'female_attack_1.ogg', V + 'female_go_out_against_1.ogg'],
    'cmd_gather_m': [V + 'male_work_land_1.ogg', V + 'male_gather_together_1.ogg'],
    'cmd_gather_f': [V + 'female_work_land_1.ogg', V + 'female_gather_together_1.ogg'],
    'cmd_build_m': [V + 'male_build_1.ogg', V + 'male_repair_1.ogg'],
    'cmd_build_f': [V + 'female_build_1.ogg', V + 'female_repair_1.ogg'],
    'cmd_garrison_m': [V + 'male_garrison_1.ogg'],
    'cmd_garrison_f': [V + 'female_garrison_1.ogg'],
    'cmd_heal_m': [V + 'male_heal_1.ogg'],
    'cmd_cav': ['actor/fauna/animal/horse_idle1.ogg', 'actor/fauna/animal/horse_idle2.ogg'],
    'cmd_cav_attack': ['actor/fauna/animal/horse_attack1.ogg', 'actor/fauna/animal/horse_attack3.ogg'],
    'cmd_siege': [('attack/siege/ram_move.ogg', {}), ('attack/siege/onager_moving_11.ogg', {'max': 1.2})],
    'cmd_siege_attack': ['attack/siege/ram_attack_order.ogg'],
    'cmd_ship': [('actor/ship/warship_move_01.ogg', {'max': 1.2})],
    'cmd_elephant': ['actor/fauna/animal/elephant_order1.ogg', 'actor/fauna/animal/elephant_order2.ogg'],
}
SFX_BITRATE = '48k'
SFX_TARGET = 10 ** (-14 / 20)          # short-term (50 ms) RMS of the loudest spot
SFX_PEAK = 10 ** (-1 / 20)


def run(cmd, data=None):
    r = subprocess.run(cmd, input=data, capture_output=True)
    if r.returncode:
        raise RuntimeError(' '.join(cmd) + '\n' + r.stderr.decode(errors='replace')[-800:])
    return r.stdout


def decode(path, channels):
    raw = run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', str(channels), '-ar', str(SR), '-'])
    return np.frombuffer(raw, dtype='<f4').reshape(-1, channels).astype(np.float64)


def encode(x, path, bitrate):
    x = np.ascontiguousarray(np.clip(x, -1, 1).astype('<f4'))
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(x.shape[1]), '-i', '-',
         '-c:a', 'libopus', '-b:a', bitrate, '-application', 'audio', path], x.tobytes())


def channels_of(path):
    out = run(['ffprobe', '-v', 'error', '-show_entries', 'stream=channels', '-of', 'csv=p=0', path])
    return int(out.split()[0])


def resample(x, k):
    """A pitch shift together with tempo (like a player at another speed): k > 1 - higher and shorter."""
    n = int(len(x) / k)
    src = np.arange(n) * k
    return np.stack([np.interp(src, np.arange(len(x)), x[:, c]) for c in range(x.shape[1])], axis=1)


def process_sfx(src, opt):
    ch = min(2, channels_of(src)) if opt.get('stereo', src.startswith(os.path.join(RAW, 'interface/alarm'))) else 1
    x = decode(src, ch)
    if opt.get('start'):
        x = x[int(opt['start'] * SR):]
    env = np.abs(x).max(axis=1)
    thr = max(env.max() * 10 ** (-45 / 20), 1e-5)
    loud = np.nonzero(env > thr)[0]
    if len(loud):
        a = max(0, loud[0] - int(0.004 * SR))
        b = min(len(x), loud[-1] + int(0.03 * SR))
        x = x[a:b]
    mx = opt.get('max')
    if mx and len(x) > mx * SR:
        x = x[:int(mx * SR)].copy()
        nf = int(min(0.35, mx * 0.3) * SR)
        x[-nf:] *= np.linspace(1, 0, nf)[:, None] ** 1.5
    fi = opt.get('fade_in')
    if fi:
        nf = int(fi * SR)
        x[:nf] *= np.linspace(0, 1, nf)[:, None]
    nf = min(len(x), int(0.01 * SR))
    x[-nf:] *= np.linspace(1, 0, nf)[:, None]
    # loudness: the loudest 50 ms window -> SFX_TARGET, the peak no higher than -1 dBFS
    w = int(0.05 * SR)
    p2 = (x ** 2).mean(axis=1)
    if len(p2) > w:
        rms = float(np.sqrt(np.convolve(p2, np.ones(w) / w, 'valid').max()))
    else:
        rms = float(np.sqrt(p2.mean()))
    peak = float(np.abs(x).max()) or 1.0
    g = min(SFX_TARGET / max(rms, 1e-6), SFX_PEAK / peak) * 10 ** (opt.get('gain', 0) / 20)
    return x * g


def build_sfx(jobs):
    out = {}
    files = {}
    tasks = []
    for name, entries in SFX.items():
        for e in entries:
            rel, opt = (e, {}) if isinstance(e, str) else e
            tasks.append((name, rel, opt))

    def one(t):
        name, rel, opt = t
        src = os.path.join(RAW, rel)
        x = process_sfx(src, opt)
        base = re.sub(r'[^A-Za-z0-9_]+', '_', os.path.splitext(os.path.basename(rel))[0])
        res = []
        variants = [] if opt.get('only_pitched') else [(1.0, '')]
        variants += [(k, f'_p{int(round(k * 100))}') for k in opt.get('pitch', ())]
        for k, suf in variants:
            y = x if k == 1.0 else resample(x, k)
            y = y * min(1.0, SFX_PEAK / max(float(np.abs(y).max()), 1e-9))
            dst_rel = f'sfx/{name}/{base}{suf}.opus'
            dst = os.path.join(OUT, dst_rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            encode(y, dst, SFX_BITRATE)
            ch = 'stereo' if y.shape[1] == 2 else 'mono'
            changes = (f'silence trimmed{", shortened to %.1f s with a fade" % opt["max"] if opt.get("max") else ""}'
                       f'{", fragment from %.1f s" % opt["start"] if opt.get("start") else ""}, loudness leveled'
                       f'{", speed/pitch x%.2f" % k if k != 1.0 else ""}; {ch}, Opus {SFX_BITRATE}')
            res.append((name, dst_rel, {'source': UPSTREAM + rel, 'license': LICENSE, 'credit': CREDIT,
                                        'changes': changes, 'duration': round(len(y) / SR, 3),
                                        'bytes': os.path.getsize(dst)}))
        return res

    with cf.ThreadPoolExecutor(jobs) as ex:
        for res in ex.map(one, tasks):
            for name, dst_rel, meta in res:
                out.setdefault(name, []).append(dst_rel)
                files[dst_rel] = meta
    return out, files


def loudnorm_args(src):
    """A two-pass loudnorm: the 1st pass measures, the 2nd applies a linear gain."""
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', src, '-af',
                        f'loudnorm=I={MUSIC_LUFS}:TP=-1.5:LRA=14:print_format=json', '-f', 'null', '-'],
                       capture_output=True, text=True)
    js = json.loads(r.stderr[r.stderr.rindex('{'):r.stderr.rindex('}') + 1])
    return (f'loudnorm=I={MUSIC_LUFS}:TP=-1.5:LRA=14:measured_I={js["input_i"]}:measured_TP={js["input_tp"]}:'
            f'measured_LRA={js["input_lra"]}:measured_thresh={js["input_thresh"]}:offset={js["target_offset"]}:'
            f'linear=true'), float(js['input_i'])


def build_music(jobs):
    out = {}
    files = {}
    tasks = [(role, t) for role, lst in MUSIC.items() for t in lst]

    def one(t):
        role, title = t
        src = os.path.join(RAW, 'music', title + '.ogg')
        name = re.sub(r'[^A-Za-z0-9_-]+', '', title.replace(' ', '_'))
        dst_rel = f'music/{name}.opus'
        dst = os.path.join(OUT, dst_rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        af, lufs = loudnorm_args(src)
        run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-af', af, '-ar', str(SR), '-c:a', 'libopus',
             '-b:a', MUSIC_BITRATE, '-application', 'audio', '-vbr', 'on', dst])
        dur = float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', dst]))
        return role, dst_rel, {'title': title.replace('_', ' '), 'source': UPSTREAM + 'music/' + title + '.ogg',
                               'license': LICENSE, 'credit': CREDIT + '; music - Omri Lahav et al. (see CREDITS.md)',
                               'changes': f'loudness leveled ({lufs:.1f} → {MUSIC_LUFS:.0f} LUFS), '
                                          f'Opus {MUSIC_BITRATE}',
                               'duration': round(dur, 2), 'bytes': os.path.getsize(dst)}

    with cf.ThreadPoolExecutor(jobs) as ex:
        for role, dst_rel, meta in ex.map(one, tasks):
            out.setdefault(role, []).append(dst_rel)
            files[dst_rel] = meta
    for role in out:           # the order as in MUSIC (ex.map preserves it anyway, but just in case)
        out[role].sort(key=lambda p: [re.sub(r'[^A-Za-z0-9_-]+', '', t) for t in MUSIC[role]].index(
            os.path.splitext(os.path.basename(p))[0]))
    return out, files


def main():
    global RAW
    ap = argparse.ArgumentParser()
    ap.add_argument('--jobs', type=int, default=8)
    ap.add_argument('--sfx-only', action='store_true')
    ap.add_argument('--raw', default=RAW, help='the public/audio folder from assets/0ad_raw')
    a = ap.parse_args()
    RAW = os.path.abspath(a.raw)
    if not os.path.isdir(RAW):
        sys.exit(f'no {RAW}: run tools/fetch_0ad.py first')
    man_path = os.path.join(OUT, 'manifest.json')
    old = {}
    if a.sfx_only and os.path.exists(man_path):
        with open(man_path) as f:
            old = json.load(f)
    if os.path.isdir(os.path.join(OUT, 'sfx')):
        shutil.rmtree(os.path.join(OUT, 'sfx'))
    sfx, files = build_sfx(a.jobs)
    if a.sfx_only and old:
        music = old['music']
        files.update({k: v for k, v in old['files'].items() if k.startswith('music/')})
    else:
        if os.path.isdir(os.path.join(OUT, 'music')):
            shutil.rmtree(os.path.join(OUT, 'music'))
        music, mf = build_music(a.jobs)
        files.update(mf)
    commit = ''
    try:
        with open(os.path.join(ROOT, 'assets', '0ad_raw', 'manifest.json')) as f:
            commit = json.load(f).get('commit', '')
    except (OSError, ValueError):
        pass
    man = {'about': 'Sounds and music from 0 A.D. (Wildfire Games), modified (see the file\'s changes). '
                    'License CC BY-SA 3.0; these files are distributed under the same license.',
           'source': f'{REPO} @ {commit}', 'license': LICENSE, 'credit': CREDIT,
           'music': music, 'sfx': dict(sorted(sfx.items())), 'files': dict(sorted(files.items()))}
    with open(man_path, 'w') as f:
        json.dump(man, f, ensure_ascii=False, indent=1)
    tot = {k: sum(v['bytes'] for p, v in files.items() if p.startswith(k)) for k in ('music/', 'sfx/')}
    print(f'music: {sum(len(v) for v in music.values())} pieces, {tot["music/"] / 1e6:.1f} MB; '
          f'effects: {len(sfx)} events, {sum(len(v) for v in sfx.values())} files, {tot["sfx/"] / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
