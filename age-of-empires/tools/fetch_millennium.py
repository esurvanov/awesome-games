#!/usr/bin/env python3
"""Reproducible fetch of the art subset of the medieval 0 A.D. mod **Millennium A.D.**

Upstream: https://github.com/0ADMods/millenniumad (pinned to COMMIT below).
Licensing (see CREDITS.md / docs/licensing.md):
  * `art/license.txt` of the mod: files under `art/` are (C) 2015 The Council of Modders,
    Fallen Empire Studio, Scion Development, **CC BY-SA 3.0** ("if not noted otherwise";
    no other notes exist in `art/`).
  * repository root `License.txt` = GPL-2.0 — covers code (simulation JS, GUI); we use none of it.
  * audio/music (Antti Martikainen etc.) is NOT fetched.

The mod sits on top of 0 A.D.'s `public` mod: its actors reference public meshes, textures,
skeletons and animations. The engine resolves every path with mod priority (millenniumad first,
then public); tools/render3d/assets.py does the same.

How it works
------------
1. Blobless, shallow clone of the mod (no LFS: blobs are plain git objects) into
   assets/millenniumad_raw/_repo; sparse checkout of the XML only (actors, variants, skeletons,
   license, readme).
2. Root actors (medieval civs' structures and units, see ROOTS) are walked recursively (props,
   variants, meshes, textures, animations). Every reference is looked up first in the mod tree,
   then in 0 A.D. public (LFS pointer tree of tools/fetch_0ad.py).
3. Mod files -> added to the sparse checkout (git fetches the missing blobs in one batch).
   Public files that assets/0ad_raw/ does not have yet -> downloaded through the 0 A.D. LFS batch
   API into assets/millenniumad_raw/public_deps/<public/art/...> (sha256-verified).
4. assets/millenniumad_raw/manifest.json lists everything (+ dangling references).

Usage:  python tools/fetch_millennium.py [--plan-only] [--jobs 16]
Re-running is incremental.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import fnmatch
import json
import os
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools import fetch_0ad  # noqa: E402

REPO_URL = "https://github.com/0ADMods/millenniumad.git"
COMMIT = "91636b405ee8d0088ec3a34fba6074dbd5c9d0f3"  # master, 2026-04-02 (v0.28.5)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "millenniumad_raw"
REPO = OUT / "_repo"
DEPS = OUT / "public_deps"          # public/art/... files not present in assets/0ad_raw

SPARSE_XML = ["/art/actors/", "/art/variants/", "/art/skeletons/", "/art/license.txt",
              "/readme.md", "/License.txt", "/mod.json"]

MIL_CIVS_S = ["anglo", "byzantines", "carolingian", "norse", "umayyads", "rus"]
MIL_CIVS_U = ["anglo", "byzantines", "caro", "norse", "umayyads", "rus"]
SKIP = ["wonder*", "hero_*", "*hero*", "palace*", "tang*", "erik_the_red*", "hastein*",
        "ivar_the_boneless*", "*charlemagne*", "fndn_hagia*", "assassin*", "minister*",
        "*_fire.xml", "infantry_archer_*_fire.xml"]
ROOTS = ([f"structures/{c}/*.xml" for c in MIL_CIVS_S]
         + [f"units/{c}/*.xml" for c in MIL_CIVS_U]
         + ["units/trader.xml"])


def run(cmd, cwd=None, inp=None):
    print("+", " ".join(cmd[:6]), "…" if len(cmd) > 6 else "", flush=True)
    subprocess.run(cmd, cwd=cwd, check=True, input=inp, text=inp is not None)


def ensure_repo():
    if not (REPO / ".git").exists():
        REPO.parent.mkdir(parents=True, exist_ok=True)
        run(["git", "clone", "--filter=blob:none", "--no-checkout", "--depth", "1", REPO_URL, str(REPO)])
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True, text=True).stdout.strip()
    if head != COMMIT:
        run(["git", "fetch", "--filter=blob:none", "--depth", "1", "origin", COMMIT], cwd=REPO)
        run(["git", "-c", "advice.detachedHead=false", "checkout", "--no-progress", "-q", COMMIT], cwd=REPO)
    run(["git", "sparse-checkout", "init", "--no-cone"], cwd=REPO)
    run(["git", "sparse-checkout", "set", "--no-cone", *SPARSE_XML], cwd=REPO)


def mod_tree():
    """{path: size} of every blob in the pinned mod commit (trees only, no blob download)."""
    out = subprocess.run(["git", "ls-tree", "-r", "--name-only", COMMIT], cwd=REPO,
                         capture_output=True, text=True, check=True).stdout
    return set(out.split("\n")) - {""}


def public_tree():
    """0 A.D. pointer tree (from tools/fetch_0ad.py; main checkout if this worktree has none)."""
    repo = fetch_0ad.REPO
    if not (repo / fetch_0ad.MODS).exists():
        alt = ROOT.parent.parent.parent / "assets" / "0ad_raw" / "_repo"
        if (alt / fetch_0ad.MODS).exists():
            fetch_0ad.REPO = alt
        else:
            sys.exit("no 0 A.D. checkout: run tools/fetch_0ad.py first")
    return fetch_0ad.Tree()


def raw_0ad():
    from tools.render3d import assets
    return Path(assets.RAW)


def resolve(mod: set, pub):
    mod_files, pub_files, missing = set(), set(), set()

    def find(rel):
        """rel under art/ → ('mod'|'pub', path) or None."""
        if f"art/{rel}" in mod:
            mod_files.add(f"art/{rel}")
            return REPO / "art" / rel
        pr = f"public/art/{rel}"
        if pub.exists(pr):
            pub_files.add(pr)
            return pub.files[pr]
        missing.add(rel)
        return None

    todo = []
    for pat in ROOTS:
        for p in sorted(mod):
            if not p.endswith(".xml") or not fnmatch.fnmatchcase(p, f"art/actors/{pat}"):
                continue
            if any(fnmatch.fnmatchcase(p.rsplit("/", 1)[-1], s) for s in SKIP):
                continue
            todo.append(p[len("art/"):])
    seen = set()
    while todo:
        rel = todo.pop()
        if rel in seen:
            continue
        seen.add(rel)
        path = find(rel)
        if path is None or not path.exists():
            continue
        try:
            root = ET.parse(path).getroot()
        except ET.ParseError as e:
            print("WARN parse", rel, e)
            continue
        for el in root.iter():
            tag, a = el.tag, el.attrib
            if tag == "prop" and a.get("actor"):
                if not a["actor"].startswith("particle/"):
                    todo.append(f"actors/{a['actor']}")
            elif tag == "variant" and a.get("file"):
                todo.append(f"variants/{a['file']}")
            elif tag == "actor" and a.get("file"):
                todo.append(f"actors/{a['file']}")
            elif tag == "texture" and a.get("file"):
                f = a["file"]
                if find(f"textures/skins/{f}") is None:
                    # engine accepts .png/.dds interchangeably
                    b, e = os.path.splitext(f)
                    for alt in (".dds", ".png"):
                        if alt != e and find(f"textures/skins/{b}{alt}") is not None:
                            missing.discard(f"textures/skins/{f}")
                            break
            elif tag == "animation" and a.get("file"):
                find(f"animation/{a['file']}")
            elif tag == "mesh" and (el.text or "").strip():
                find(f"meshes/{el.text.strip()}")
    return sorted(mod_files), sorted(pub_files), sorted(missing)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan-only", action="store_true")
    ap.add_argument("--jobs", type=int, default=16)
    args = ap.parse_args()

    ensure_repo()
    mod = mod_tree()
    pub = public_tree()
    mod_files, pub_files, missing = resolve(mod, pub)
    have = raw_0ad()
    need_pub = []
    for rel in pub_files:
        if (have / rel).exists():
            continue
        ptr = pub.pointer(rel)
        size = ptr[1] if ptr else pub.files[rel].stat().st_size
        need_pub.append((rel, ptr[0] if ptr else None, size))
    print(f"mod files: {len(mod_files)}; public deps: {len(pub_files)} "
          f"({len(need_pub)} not in assets/0ad_raw, {sum(s for *_, s in need_pub) / 1e6:.1f} MB); "
          f"dangling: {len(missing)}")
    if args.plan_only:
        by = {}
        for p in mod_files:
            k = "/".join(p.split("/")[:3])
            by[k] = by.get(k, 0) + 1
        for k, v in sorted(by.items()):
            print(f"{v:6d}  {k}")
        for m in missing[:40]:
            print("  dangling:", m)
        return

    # 1. mod blobs: sparse checkout of the exact files (one batched fetch)
    pats = SPARSE_XML + ["/" + p for p in mod_files]
    run(["git", "sparse-checkout", "set", "--no-cone", "--stdin"], cwd=REPO, inp="\n".join(pats) + "\n")

    # 2. public deps through the LFS batch API
    DEPS.mkdir(parents=True, exist_ok=True)
    jobs = []
    for rel, oid, size in need_pub:
        dest = DEPS / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        if oid is None:
            shutil.copyfile(pub.files[rel], dest)
        elif not (dest.exists() and dest.stat().st_size == size and fetch_0ad.sha256_file(dest) == oid):
            jobs.append((rel, oid, size))
    print(f"{len(jobs)} LFS objects to download ({sum(j[2] for j in jobs) / 1e6:.1f} MB)", flush=True)
    uniq = {}
    for rel, oid, size in jobs:
        uniq.setdefault(oid, (size, []))[1].append(rel)
    oids = list(uniq.items())
    tasks = []
    for i in range(0, len(oids), 100):
        for o in fetch_0ad.lfs_batch([(oid, sz) for oid, (sz, _) in oids[i:i + 100]]):
            if "error" in o:
                print("LFS error", o["oid"], o["error"])
                continue
            act = o["actions"]["download"]
            tasks.append((o["oid"], act["href"], act.get("header", {})))
    with cf.ThreadPoolExecutor(args.jobs) as ex:
        futs = {ex.submit(fetch_0ad.download, h, hd, DEPS / uniq[o][1][0], o): uniq[o][1] for o, h, hd in tasks}
        for f in cf.as_completed(futs):
            f.result()
            rels = futs[f]
            for extra in rels[1:]:
                shutil.copyfile(DEPS / rels[0], DEPS / extra)

    manifest = {"source": REPO_URL, "commit": COMMIT,
                "license": "art/: CC BY-SA 3.0 (C) The Council of Modders, Fallen Empire Studio, "
                           "Scion Development (art/license.txt); repo code: GPL-2.0 (not used)",
                "mod_files": mod_files,
                "public_deps": {"source": fetch_0ad.REPO_URL, "commit": fetch_0ad.COMMIT,
                                "files": [{"path": r, "size": s, "sha256": o} for r, o, s in need_pub]},
                "dangling_references": missing}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    tot = sum((REPO / p).stat().st_size for p in mod_files if (REPO / p).exists())
    print(f"done: {len(mod_files)} mod files ({tot / 1e6:.0f} MB), {len(need_pub)} public deps -> {OUT}")


if __name__ == "__main__":
    sys.exit(main())
