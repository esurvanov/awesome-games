#!/usr/bin/env python3
"""Reproducible fetch of a curated subset of 0 A.D. (Wildfire Games) assets.

Art/audio in 0 A.D. are CC-BY-SA 3.0 (see CREDITS.md). Nothing from Microsoft /
Age of Empires is used.

How it works
------------
1. Blobless, shallow, sparse clone of the upstream repository
   (https://gitea.wildfiregames.com/0ad/0ad) pinned to COMMIT, with LFS smudge
   disabled -> only small XML files and LFS *pointer* files land on disk.
2. Selection: root actors / terrains / audio / UI globs are expanded, then every
   actor is walked recursively (props, variants, meshes, textures, animations,
   materials, particles) to get the full dependency closure.
3. LFS objects of the selected files are downloaded through the Git LFS batch
   API, sha256-verified, and written to assets/0ad_raw/<mod>/<path> (paths are
   relative to binaries/data/mods/, e.g. public/art/meshes/...).
4. assets/0ad_raw/manifest.json lists every file with size and oid.

Usage:  python tools/fetch_0ad.py [--plan-only] [--jobs 16]
Re-running is incremental: files whose sha256 already matches are skipped.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import fnmatch
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

REPO_URL = "https://gitea.wildfiregames.com/0ad/0ad.git"
LFS_BATCH = REPO_URL + "/info/lfs/objects/batch"
COMMIT = "0ed48b3a1fb1b4b718a78869fa497185af55e086"  # main, 2026-09-24

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(os.environ["OAD_RAW"]) if os.environ.get("OAD_RAW") else ROOT / "assets" / "0ad_raw"
REPO = OUT / "_repo"
MODS = "binaries/data/mods"
PUB = "public"
ART = "public/art"

SPARSE = [
    "/LICENSE.md", "/license_gpl-2.0.txt",
    f"/{MODS}/public/art/", f"/{MODS}/public/audio/",
    f"/{MODS}/public/gui/credits/", f"/{MODS}/mod/fonts/",
]

# ---------------------------------------------------------------- selection
# Civs whose look fits a medieval-ish European/Asian setting.
STRUCT_CIVS = ["britons", "celts", "gauls", "germans", "iberians", "romans",
               "achaemenids", "han"]
STRUCT_SKIP = ["wonder*", "*theater*", "amphitheater*", "capitoline*", "sp_*",
               "triumphal*", "*siege_wall*", "uffington*", "apadana*", "palace*",
               "tachara*", "lamassu*", "imperial_*", "misc_*", "gardens*",
               "*winter*", "fortress_old*", "camp*", "*encampment*", "stone_monument*",
               "small_stone_monument*", "cult_statue*", "temple_ambient*",
               "babylonian_tower*", "crannog*", "*_fire.xml"]
UNIT_CIVS = ["britons", "gauls", "germans", "iberians", "romans",
             "achaemenids", "han"]
UNIT_GLOBS = [
    "infantry_*_b.xml", "infantry_swordsman_c*.xml", "infantry_axeman_c.xml",
    "cavalry_*_b_[mr].xml", "cavalry_*_c_[mr].xml", "cavalry_scout*.xml",
    "citizen_*.xml", "female_citizen.xml", "healer*.xml", "trader*.xml",
    "fisherman.xml", "siege_*.xml",
]
ACTOR_ROOTS = [
    f"structures/{c}/*.xml" for c in STRUCT_CIVS
] + [
    f"units/{c}/{g}" for c in UNIT_CIVS for g in UNIT_GLOBS
] + [
    "structures/viking/longship.xml",
    # European-looking foot archers (Cretan/Greek) and a crossbow (gastraphetes)
    "units/athenians/infantry_archer_b.xml",
    "units/macedonians/infantry_crossbowman_c.xml",
    # units round 2 (docs/research/06_units_recognition.md): howdah for the war elephant, bare-torso
    # fanatic head (woad raider), repeating crossbow (chu ko nu)
    "props/units/elephant/howdah_sele_01.xml", "props/units/elephant/howdah_cart_01.xml",
    "props/units/heads/head_celt_fanatic.xml", "props/units/heads/new/head_celt_fanatic.xml",
    "props/units/weapons/crossbow/han_liannu.xml",
    "structures/plot_field*.xml", "structures/plot_corral.xml",
    "structures/plot_orchard.xml", "structures/fndn_*.xml",
    "structures/destruct_stone_*.xml", "structures/destruct_wood_3x3.xml",
    # flora (temperate / European)
    *[f"flora/trees/{p}*.xml" for p in (
        "oak", "pine", "european_beech", "poplar", "fir", "euro_birch", "elm",
        "temperate_", "apple", "deci_", "willow", "maple", "dead_", "tree_dead",
        "snow_pine", "juniper", "cherry_small", "eyecandy_fern", "grass_1",
        # landscape themes of the map generator (tools/build_map_assets.py)
        "palm_date_new", "palm_tropical", "acacia", "baobab", "tree_tropic",
        "tropic_forest_biome")],
    "flora/bushes/*.xml",
    # berry bushes (forage) and temperate eye-candy (bushes, grass, ferns, reeds)
    "props/flora/berr*.xml", "props/flora/bush_berries_large.xml",
    "props/flora/bush_tempe*.xml", "props/flora/bush_hedge.xml",
    "props/flora/bush_highlands.xml", "props/flora/grass_temp_*.xml",
    "props/flora/grass_soft_*.xml", "props/flora/grass_field_lush_*.xml",
    "props/flora/grass_field_flowering_tall.xml", "props/flora/ferns.xml",
    "props/flora/flower_bright.xml", "props/flora/decals_flowers_daisies.xml",
    "props/flora/reeds_*.xml", "props/flora/temperate_*.xml",
    "props/flora/farming_wheat_*.xml", "props/flora/water_log.xml",
    # geology: temperate mines and rocks
    "geology/*temperate*.xml", "geology/stone_granite_*.xml",
    "geology/stonemine_granite*.xml", "geology/metalmine_granite*.xml",
    "geology/highland*.xml", "geology/gray*.xml", "geology/shoreline_*.xml",
    # fauna
    *[f"fauna/{a}.xml" for a in (
        "sheep1", "sheep2", "sheep3", "deer", "deer1", "deer2", "deer3", "boar",
        "pig1", "cow", "chicken", "goat", "wolf", "bear_brown", "fox_red",
        "rabbit1", "fish", "fish_generic", "fish_single", "whale", "whale_fin",
        "horse", "pony", "horse_celtic", "horse_brown", "horse_black",
        "horse_white", "horse_gray", "donkey", "mastiff", "seagull", "crow",
        "hawk")],
]
# Directories taken wholesale (small / generic).
WHOLE_DIRS = [
    f"{ART}/materials/", f"{ART}/skeletons/", f"{ART}/particles/",
    f"{ART}/textures/particles/", f"{ART}/textures/animated/water/",
    f"{ART}/textures/cursors/", f"{ART}/textures/selection/",
    f"{ART}/textures/terrain/alphamaps/", f"{ART}/terrains/",
    "public/gui/credits/", "mod/fonts/",
]
TERRAIN_GROUPS = ["biome-temperate", "biome-temperate-europe",
                  "biome-temperate-autumn", "biome-baltic-nordic", "grass",
                  "dirt", "forestfloor", "road", "sand", "shoreline", "cliff",
                  "water", "special",
                  # landscape themes (tools/build_map_assets.py)
                  "biome-desert", "biome-savanna", "biome-steppe", "biome-alpine",
                  "biome-alpine-arctic", "biome-polar", "biome-tropic", "snow"]
UI_EXCLUDE = ["*/icons/mappreview/*", "*/pregame/backgrounds/*", "*/tips/*",
              "*/loading/*"]
AUDIO_EXCLUDE = ["*/voice/napatan/*", "*/voice/persian/*", "*/ambient/weather/*"]
MUSIC = [  # peaceful / battle / menu / victory / defeat
    "Celtica", "Celtic_Pride", "Highland_Mist", "Cisalpine_Gaul",
    "Harvest_Festival", "Harvest_Moon", "Tavern_in_the_Mist", "Northern_Frontier",
    "Albian_Nocturne", "Mountain_Idyll", "Sunrise", "The_Fledgling_Kingdom",
    "Water's_Edge", "As_Seasons_Change", "Eastern_Dreams", "Juno_Protect_You",
    "Forging_a_City-State", "The_Road_Ahead", "Midwinter", "Solstice_Festival",
    # battle
    "Honor_Bound", "Tale_of_Warriors", "Red_Dawn", "Calm_Before_the_Storm",
    "Point_of_No_Return", "Harsh_Lands_Rugged_People", "A_Brothers_Revenge",
    "Bandit_Country", "Taiko_1", "Taiko_2", "Upstart_King",
    # menu / end
    "Epitaph", "Dried_Tears", "You_are_Victorious!", "Hill_of_Sorrows",
    "An_old_Warhorse_goes_to_Pasture",
]


def run(cmd, cwd=None, env=None):
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=cwd, env=env, check=True)


def ensure_repo():
    env = dict(os.environ, GIT_LFS_SKIP_SMUDGE="1")
    if not (REPO / ".git").exists():
        REPO.parent.mkdir(parents=True, exist_ok=True)
        run(["git", "clone", "--filter=blob:none", "--no-checkout", "--depth", "1",
             REPO_URL, str(REPO)], env=env)
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, env=env,
                          capture_output=True, text=True).stdout.strip()
    if head != COMMIT:
        run(["git", "fetch", "--filter=blob:none", "--depth", "1", "origin", COMMIT],
            cwd=REPO, env=env)
    run(["git", "sparse-checkout", "init", "--no-cone"], cwd=REPO, env=env)
    run(["git", "sparse-checkout", "set", "--no-cone", *SPARSE], cwd=REPO, env=env)
    run(["git", "-c", "advice.detachedHead=false", "checkout", "--force", COMMIT],
        cwd=REPO, env=env)


class Tree:
    """Index of files under binaries/data/mods (pointer-aware)."""

    def __init__(self):
        self.base = REPO / MODS
        self.files = {}
        for dp, _, fns in os.walk(self.base):
            for fn in fns:
                p = Path(dp) / fn
                self.files[p.relative_to(self.base).as_posix()] = p

    def exists(self, rel):
        return rel in self.files

    def glob(self, pattern):
        return sorted(f for f in self.files if fnmatch.fnmatchcase(f, pattern))

    def under(self, prefix):
        return sorted(f for f in self.files if f.startswith(prefix))

    def pointer(self, rel):
        """(oid, size) for an LFS pointer, None for a regular file."""
        p = self.files[rel]
        with open(p, "rb") as fh:
            head = fh.read(256)
        if not head.startswith(b"version https://git-lfs"):
            return None
        txt = head.decode()
        oid = re.search(r"oid sha256:([0-9a-f]{64})", txt).group(1)
        size = int(re.search(r"size (\d+)", txt).group(1))
        return oid, size


def resolve(tree: Tree):
    wanted: set[str] = set()
    missing: set[str] = set()

    def add(rel):
        if tree.exists(rel):
            wanted.add(rel)
            return True
        missing.add(rel)
        return False

    todo: list[str] = []
    for pat in ACTOR_ROOTS:
        hits = tree.glob(f"{ART}/actors/{pat}")
        for h in hits:
            name = h.rsplit("/", 1)[-1]
            if "/structures/" in h and any(fnmatch.fnmatchcase(name, s) for s in STRUCT_SKIP):
                continue
            todo.append(h)
    seen_xml: set[str] = set()
    while todo:
        rel = todo.pop()
        if rel in seen_xml:
            continue
        seen_xml.add(rel)
        if not add(rel):
            continue
        try:
            root = ET.parse(tree.files[rel]).getroot()
        except ET.ParseError as e:
            print("WARN parse", rel, e)
            continue
        for el in root.iter():
            tag, a = el.tag, el.attrib
            if tag == "prop" and a.get("actor"):
                todo.append(f"{ART}/actors/{a['actor']}")
            elif tag == "variant" and a.get("file"):
                todo.append(f"{ART}/variants/{a['file']}")
            elif tag == "actor" and a.get("file"):  # qualitylevels
                todo.append(f"{ART}/actors/{a['file']}")
            elif tag == "texture" and a.get("file"):
                add(f"{ART}/textures/skins/{a['file']}")
            elif tag == "animation" and a.get("file"):
                add(f"{ART}/animation/{a['file']}")
            elif tag == "mesh" and (el.text or "").strip():
                add(f"{ART}/meshes/{el.text.strip()}")
            elif tag == "material" and (el.text or "").strip():
                add(f"{ART}/materials/{el.text.strip()}")
            elif tag == "particles" and a.get("file"):
                add(f"{ART}/particles/{a['file']}")

    for d in WHOLE_DIRS:
        wanted.update(f for f in tree.under(d) if "SourceHanSans" not in f)
    # skins/textures.xml carry per-folder texture conversion settings
    wanted.update(f for f in tree.glob(f"{ART}/textures/skins/*textures.xml"))
    # terrains -> textures
    for g in TERRAIN_GROUPS:
        for rel in tree.glob(f"{ART}/terrains/{g}/*.xml"):
            wanted.add(rel)
            for el in ET.parse(tree.files[rel]).getroot().iter("texture"):
                if el.get("file"):
                    add(f"{ART}/textures/terrain/{el.get('file')}")
    wanted.update(tree.glob(f"{ART}/textures/terrain/types/*textures.xml"))
    wanted.update(tree.glob(f"{ART}/textures/terrain/*.xml"))
    # UI textures
    for rel in tree.under(f"{ART}/textures/ui/"):
        if not any(fnmatch.fnmatchcase(rel, x) for x in UI_EXCLUDE):
            wanted.add(rel)
    # audio: all SFX (minus excluded), selected music
    for rel in tree.under("public/audio/"):
        if "/audio/music/" in rel:
            continue
        if not any(fnmatch.fnmatchcase(rel, x) for x in AUDIO_EXCLUDE):
            wanted.add(rel)
    for m in MUSIC:
        add(f"public/audio/music/{m}.ogg")
    add("public/art/LICENSE.txt")
    add("public/audio/LICENSE.txt")
    # prune references to animations/textures that do not exist (engine
    # falls back); report them
    return sorted(wanted), sorted(missing)


def lfs_batch(objs):
    body = json.dumps({"operation": "download", "transfers": ["basic"],
                       "objects": [{"oid": o, "size": s} for o, s in objs]}).encode()
    req = urllib.request.Request(LFS_BATCH, data=body, headers={
        "Accept": "application/vnd.git-lfs+json",
        "Content-Type": "application/vnd.git-lfs+json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)["objects"]


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(href, headers, dest: Path, oid):
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(4):
        try:
            req = urllib.request.Request(href, headers=headers or {})
            with urllib.request.urlopen(req, timeout=300) as r, open(tmp, "wb") as fh:
                shutil.copyfileobj(r, fh, 1 << 20)
            if sha256_file(tmp) != oid:
                raise IOError("sha256 mismatch")
            tmp.replace(dest)
            return
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            print("retry", dest.name, e, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan-only", action="store_true")
    ap.add_argument("--jobs", type=int, default=16)
    args = ap.parse_args()

    ensure_repo()
    tree = Tree()
    wanted, missing = resolve(tree)

    plan = []
    for rel in wanted:
        ptr = tree.pointer(rel)
        size = ptr[1] if ptr else tree.files[rel].stat().st_size
        plan.append((rel, ptr[0] if ptr else None, size))
    total = sum(s for _, _, s in plan)
    print(f"selected {len(plan)} files, {total/1e6:.1f} MB; "
          f"{len(missing)} dangling references")
    if args.plan_only:
        by = {}
        for rel, _, s in plan:
            k = "/".join(rel.split("/")[:4])
            by[k] = by.get(k, 0) + s
        for k, v in sorted(by.items(), key=lambda x: -x[1])[:40]:
            print(f"{v/1e6:9.1f} MB  {k}")
        return

    OUT.mkdir(parents=True, exist_ok=True)
    # copy plain files, collect LFS jobs
    jobs = []
    for rel, oid, size in plan:
        dest = OUT / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if oid is None:
            shutil.copyfile(tree.files[rel], dest)
        elif not (dest.exists() and dest.stat().st_size == size and sha256_file(dest) == oid):
            jobs.append((rel, oid, size))
    print(f"{len(jobs)} LFS objects to download "
          f"({sum(j[2] for j in jobs)/1e6:.1f} MB)", flush=True)

    uniq = {}
    for rel, oid, size in jobs:
        uniq.setdefault(oid, (size, []))[1].append(rel)
    oids = list(uniq.items())
    tasks = []
    for i in range(0, len(oids), 100):
        chunk = oids[i:i + 100]
        for o in lfs_batch([(oid, sz) for oid, (sz, _) in chunk]):
            if "error" in o:
                print("LFS error", o["oid"], o["error"])
                continue
            act = o["actions"]["download"]
            tasks.append((o["oid"], act["href"], act.get("header", {})))
    done = 0
    with cf.ThreadPoolExecutor(args.jobs) as ex:
        futs = {}
        for oid, href, hdr in tasks:
            rels = uniq[oid][1]
            futs[ex.submit(download, href, hdr, OUT / rels[0], oid)] = rels
        for f in cf.as_completed(futs):
            rels = futs[f]
            f.result()
            for extra in rels[1:]:
                shutil.copyfile(OUT / rels[0], OUT / extra)
            done += 1
            if done % 200 == 0:
                print(f"  {done}/{len(tasks)}", flush=True)

    manifest = {"source": REPO_URL, "commit": COMMIT,
                "files": [{"path": r, "size": s, "sha256": o} for r, o, s in plan],
                "dangling_references": missing}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print("done:", OUT)


if __name__ == "__main__":
    sys.exit(main())
