#!/usr/bin/env python3
"""Скачать эталонные DE-спрайты юнитов с ageofempires.fandom.com (только для сравнения, в gitignored shots/ref/units/).

  python3 tools/research/fetch_de_units.py
Берёт первую картинку из галереи Image= в инфобоксе страницы юнита (обычно «…DE.png» — игровой спрайт DE).
"""
import json, os, re, sys, time, urllib.parse, urllib.request

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(REPO, 'shots', 'ref', 'units')
API = 'https://ageofempires.fandom.com/api.php'
UA = {'User-Agent': 'Mozilla/5.0 (research; local comparison only)'}

PAGES = {
 'villager': 'Villager (Age of Empires II)', 'monk': 'Monk (Age of Empires II)',
 'trade_cart': 'Trade Cart', 'militia': 'Militia (Age of Empires II)', 'man_at_arms': 'Man-at-Arms',
 'long_swordsman': 'Long Swordsman', 'two_handed_swordsman': 'Two-Handed Swordsman', 'champion': 'Champion',
 'spearman': 'Spearman (Age of Empires II)', 'pikeman': 'Pikeman', 'halberdier': 'Halberdier',
 'archer': 'Archer (Age of Empires II)', 'crossbowman': 'Crossbowman', 'arbalester': 'Arbalester',
 'skirmisher': 'Skirmisher', 'elite_skirmisher': 'Elite Skirmisher', 'scout': 'Scout Cavalry',
 'light_cavalry': 'Light Cavalry', 'hussar': 'Hussar', 'knight': 'Knight (Age of Empires II)',
 'cavalier': 'Cavalier (Age of Empires II)', 'paladin': 'Paladin', 'cavalry_archer': 'Cavalry Archer (Age of Empires II)',
 'heavy_cavalry_archer': 'Heavy Cavalry Archer', 'hand_cannoneer': 'Hand Cannoneer', 'camel_rider': 'Camel Rider',
 'heavy_camel_rider': 'Heavy Camel Rider', 'ram': 'Battering Ram (Age of Empires II)', 'capped_ram': 'Capped Ram',
 'siege_ram': 'Siege Ram', 'mangonel': 'Mangonel', 'onager': 'Onager', 'siege_onager': 'Siege Onager',
 'scorpion': 'Scorpion', 'heavy_scorpion': 'Heavy Scorpion', 'bombard_cannon': 'Bombard Cannon',
 'trebuchet': 'Trebuchet (Age of Empires II)', 'throwing_axeman': 'Throwing Axeman', 'longbowman': 'Longbowman',
 'mangudai': 'Mangudai', 'cataphract': 'Cataphract', 'teutonic_knight': 'Teutonic Knight', 'samurai': 'Samurai (Age of Empires II)',
 'chu_ko_nu': 'Chu Ko Nu', 'war_elephant': 'War Elephant', 'mameluke': 'Mameluke', 'janissary': 'Janissary',
 'berserk': 'Berserk', 'huskarl': 'Huskarl', 'woad_raider': 'Woad Raider', 'conquistador': 'Conquistador',
 'fishing_ship': 'Fishing Ship', 'transport_ship': 'Transport Ship', 'galley': 'Galley (Age of Empires II)',
 'war_galley': 'War Galley', 'galleon': 'Galleon', 'fire_galley': 'Fire Galley', 'fire_ship': 'Fire Ship',
 'fast_fire_ship': 'Fast Fire Ship', 'demolition_ship': 'Demolition Raft', 'heavy_demolition_ship': 'Heavy Demolition Ship',
 'cannon_galleon': 'Cannon Galleon', 'animal_sheep': 'Sheep (Age of Empires II)', 'animal_deer': 'Deer (Age of Empires II)',
 'animal_boar': 'Wild Boar (Age of Empires II)',
}


def get(params):
    url = API + '?' + urllib.parse.urlencode(dict(params, format='json'))
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return json.load(r)


def wikitext(title):
    d = get({'action': 'parse', 'page': title, 'prop': 'wikitext', 'section': 0, 'redirects': 1})
    return d['parse']['wikitext']['*'] if 'parse' in d else None


def images_of(title):
    base = re.sub(r' \(Age of Empires II\)$', '', title)
    wt = None
    for t in (base + ' (Age of Empires II)', base):
        wt = wikitext(t)
        if wt and 'isambig' in wt[:40]:
            m = re.search(r'\[\[([^\]|]*\(Age of Empires II\))', wt)
            wt = wikitext(m.group(1)) if m else None
        if wt and 'Infobox' in wt:
            break
    if not wt:
        return []
    m = re.search(r'\|\s*[Ii]mage\s*=\s*(.*?)\n\|', wt, re.S)
    if not m:
        return []
    blk = m.group(1)
    names = re.findall(r'^\s*([^|<>\n]+\.(?:png|jpg|gif))', blk, re.M | re.I)
    names += re.findall(r'\[\[File:([^|\]]+)', blk)
    return names


def url_of(fname):
    q = get({'action': 'query', 'titles': 'File:' + fname, 'prop': 'imageinfo', 'iiprop': 'url'})
    for p in q['query']['pages'].values():
        ii = p.get('imageinfo')
        if ii:
            return ii[0]['url']


def main():
    os.makedirs(OUT, exist_ok=True)
    log = {}
    only = sys.argv[1:]
    for key, title in PAGES.items():
        if only and key not in only:
            continue
        try:
            names = images_of(title)
            log[key] = names
            for i, n in enumerate(names[:3]):
                u = url_of(n.strip())
                if not u:
                    continue
                ext = os.path.splitext(n)[1].lower()
                dst = os.path.join(OUT, f'{key}.{i}{ext}')
                with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30) as r:
                    open(dst, 'wb').write(r.read())
            print(key, names[:3])
        except Exception as e:
            print('!!', key, e)
        time.sleep(0.2)
    json.dump(log, open(os.path.join(OUT, 'sources.json'), 'w'), indent=1, ensure_ascii=False)


if __name__ == '__main__':
    main()
