/* Module "contact-core" — ONE vocabulary for what a world object is to the pilot (ARCH-CORE.md).
 *
 *  Before: "is this a rock?" was a regex copied into five modules (rock-brain, interaction, the physics slim test, …), and every new kind of
 *  object meant hunting those copies down. Now an object FAMILY is declared once here: which names belong to it, which module owns its
 *  contact behaviour, what it affords, and which body ↔ surface PAIRS apply. Modules ask CORE; nobody keeps a private list.
 *
 *  window.CORE
 *    families            [{ id, label, re, owner, role, affords:[…], status }]  (first match wins; order = specificity)
 *    familyOf(x)         x = Passport entry | physics tag | name → family id | null
 *    is(x, id…)          x belongs to one of the families
 *    surfaceRe           RegExp of every family whose faces the pilot leans / presses on (owner rock-brain) — for modules that still test names
 *    register(family)    add or replace a family (a new object kind = one call, no edits elsewhere)
 *    PAIRS               body part ↔ surface contact contracts: what MUST touch, what MUST stay clear, tolerance (cm). The pose solver and
 *                        the judge read the same table (BODYCONTACT part names, see modules/body-spec.js)
 *    AFFORDS             the shared action vocabulary
 *    coverage()          Passport kinds (modules/interact-data.js) → family: which objects have an owner, which do not
 *
 *  Status of a family: 'owned' (a module implements its contact), 'generic' (the passport mediator modules/interact.js + interaction.js),
 *  'none' (collides, no pilot behaviour). Adding behaviour to a family = give it an owner and an `affords` list; the owner module reads
 *  CORE.is(entry, id) instead of a regex.
 */
(function () {
  const AFFORDS = ['lean_back', 'lean_shoulder', 'hands_wall', 'hands_ledge', 'brace_slope', 'sit', 'squeeze', 'step_up', 'climb',
    'push', 'grab_trunk', 'pick_up', 'ride', 'warm_hands'];

  // order matters: first match wins
  const FAMILIES = [
    { id: 'stone',   label: 'rocks · boulders · outcrops', re: /^(st_)?(rock|boulder)/i, owner: 'rock-brain', role: 'solid',
      affords: ['lean_back', 'lean_shoulder', 'hands_wall', 'hands_ledge', 'brace_slope', 'sit', 'squeeze', 'step_up', 'climb'], status: 'owned' },
    { id: 'ruin',    label: 'ruins · cairns · inuksuk (dressed stone)', re: /^st_(ruin|cairn|inuksuk)/i, owner: 'rock-brain', role: 'solid',
      affords: ['lean_back', 'lean_shoulder', 'hands_wall', 'hands_ledge', 'sit', 'step_up', 'climb'], status: 'owned' },
    { id: 'tree',    label: 'trees', re: /^tree_/i, owner: 'interaction', role: 'trunk', affords: ['grab_trunk', 'lean_shoulder'], status: 'generic' },
    { id: 'prop',    label: 'crates · barrels · tools (pushable)', re: /^(prop_|crate|barrel|tool_crate|firepit)/i, owner: 'interaction', role: 'pushable', affords: ['push', 'pick_up', 'warm_hands'], status: 'generic' },
    { id: 'vehicle', label: 'vehicles · wreck', re: /^(vehicle_|kestrel|st_snowcat)/i, owner: 'open-world', role: 'solid', affords: ['ride', 'climb'], status: 'owned' },
    { id: 'structure', label: 'stations · tents · poles · sledges', re: /^(station_|struct_|st_(tent|drum|pole|sledge)|lamp_post)/i, owner: 'interact', role: 'solid', affords: ['hands_wall', 'lean_shoulder', 'climb'], status: 'generic' },
    { id: 'crystal', label: 'crystal spires', re: /^spire/i, owner: null, role: 'solid', affords: [], status: 'none' },
  ];

  // body part ↔ surface contracts (BODYCONTACT kind names, cm). touch: the part's gap to the surface must reach [0, tol]; clear: how deep the
  // part may sit inside the drawn surface before it counts as a violation (a sleeve lying on a wall is 3-5 cm "inside": that is contact,
  // not a fault); pull: which part the solver draws toward the surface and to what gap while nothing is violated (null = the palms are
  // placed by the hand IK, the body only closes to `gapCm` of the chest).
  const PAIRS = {
    wall_palm:     { touch: { palm: 1 }, clear: { fingers: 2, forearm: 4, upperarm: 3, chest: 1.5, pelvis: 1.5, helmet: 1, shin: 2, thigh: 2 }, pull: { part: 'chest', gapCm: 14 } },
    ledge_hands:   { touch: { palm: 1 }, clear: { fingers: 2, forearm: 4, chest: 1.5, helmet: 1, shin: 2 }, pull: { part: 'chest', gapCm: 14 } },
    wall_back:     { touch: { chest: 2 }, clear: { helmet: 1, pelvis: 2, shin: 2, thigh: 2 }, pull: { part: 'chest', gapCm: 2 } },
    wall_shoulder: { touch: { shoulder: 2, upperarm: 2 }, clear: { helmet: 1, chest: 2, shin: 2 }, pull: { part: 'upperarm', gapCm: 2 } },
    seat:          { touch: { pelvis: 2, thigh: 2 }, clear: { chest: 2, helmet: 1, shin: 3 }, pull: { part: 'pelvis', gapCm: 2 } },
  };
  // which pair a rock-brain action plays (action name → pair)
  const PAIR_OF = { hand_wall_both: 'wall_palm', hand_wall_r: 'wall_palm', hand_wall_l: 'wall_palm', brace_slope_r: 'wall_palm', brace_slope_l: 'wall_palm',
    lean_hands_ledge: 'ledge_hands', lean_back: 'wall_back', lean_shoulder_r: 'wall_shoulder', lean_shoulder_l: 'wall_shoulder', sit_rock: 'seat', sit_rock_high: 'seat' };
  const pairOf = (action) => PAIR_OF[action] || null;

  const nameOf = (x) => {
    if (!x) return '';
    if (typeof x === 'string') return x;
    if (x.name) return String(x.name);
    if (x.tag && x.tag.name) return String(x.tag.name);
    if (x.passport != null && window.INTERACT && window.INTERACT.entryById) { const e = window.INTERACT.entryById(x.passport); if (e && e.name) return String(e.name); }
    return '';
  };
  const base = (n) => n.replace(/#\d+$/, '');
  const surfaceRe = { test: (n) => { const f = familyOf(n); return !!(f && FAMILIES.find((q) => q.id === f).owner === 'rock-brain'); } };
  function familyOf(x) {
    const n = base(nameOf(x)); if (!n) return null;
    for (const f of FAMILIES) if (f.re.test(n)) return f.id;
    return null;
  }
  function is(x) { const f = familyOf(x); if (!f) return false; for (let i = 1; i < arguments.length; i++) if (arguments[i] === f) return true; return false; }
  function register(f) {
    if (!f || !f.id || !f.re) throw new Error('CORE.register: { id, re, … } needed');
    const i = FAMILIES.findIndex((q) => q.id === f.id);
    const rec = Object.assign({ label: f.id, owner: null, role: 'solid', affords: [], status: 'none' }, f);
    if (i >= 0) FAMILIES[i] = rec; else FAMILIES.unshift(rec);
    return rec;
  }
  function coverage() {
    const D = window.INTERACT_DATA, kinds = D && D.kinds ? Object.keys(D.kinds) : [], out = { byFamily: {}, unowned: [] };
    for (const k of kinds) { const n = k.split('|')[0], f = familyOf(n); if (f) (out.byFamily[f] = out.byFamily[f] || []).push(n); else out.unowned.push(n); }
    return out;
  }

  window.CORE = { families: FAMILIES, AFFORDS, PAIRS, PAIR_OF, pairOf, familyOf, is, register, coverage, nameOf,
    // the test the old per-module regexes did: faces the pilot leans on / presses (owner: rock-brain)
    surfaceRe, isSurface: (x) => surfaceRe.test(nameOf(x)) };
})();
