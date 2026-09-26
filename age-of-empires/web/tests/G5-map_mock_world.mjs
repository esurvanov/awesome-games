// Minimal world mock for web/tests/G5-map.test.mjs - the same mock as web/tests/gen_G5-map_ref.py (FWorld...).
// Replaces web/src/world.js and web/src/maps.js for the mapgen test only (loader hook in the test).
import fs from 'node:fs';
import { random } from '../runtime/py.js';
import * as terrain from '../src/terrain.js';

export class Node {
    constructor(kind, tx, ty) {
        this.kind = kind;
        this.tx = tx; this.ty = ty;
        this.amount = this.max_amount = 100;
        this.var = random.randrange(6);
        this.alive = true;
    }
}
export class Unit {
    constructor(kind, owner, x, y, world) { this.kind = kind; this.owner = owner; this.x = x; this.y = y; }
}
export class Animal {
    constructor(kind, x, y, world, owner = -1) { this.kind = kind; this.owner = owner; this.x = x; this.y = y; }
}
class FBuilding {
    constructor(kind, owner, tx, ty, w, h) {
        Object.assign(this, { kind, owner, tx, ty, w, h });
        this.rally = [0, 0];
    }
}
export class FWorld {
    constructor(W, map_type, teams, theme = 'grass') {
        this.W = this.H = W;
        this.map_type = map_type;
        this.players = teams.map(t => ({ team: t, res: { wood: 200, food: 200, gold: 100, stone: 200 } }));
        this.settings = { team_together: true, theme };
        this.terrain = Array.from({ length: W }, () => new Array(W).fill(0));
        this.occ = Array.from({ length: W }, () => new Array(W).fill(null));
        this.nodes = []; this.units = []; this.animals = []; this.buildings = []; this.relics = [];
        terrain.ensure(this);
    }
    passable(x, y) {
        return 0 <= x && x < this.W && 0 <= y && y < this.H && !(this.terrain[y][x] & 1) && this.occ[y][x] == null;
    }
    nearest_free_tile(tx, ty, maxr = 12) {
        if (this.passable(tx, ty)) return [tx, ty];
        for (let r = 1; r < maxr; r++) {
            let best = null, bd = 1e9;
            for (let dy = -r; dy <= r; dy++)
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                    if (this.passable(tx + dx, ty + dy)) {
                        const d = dx * dx + dy * dy;
                        if (d < bd) { bd = d; best = [tx + dx, ty + dy]; }
                    }
                }
            if (best) return best;
        }
        return [tx, ty];
    }
    place_building(kind, pid, tx, ty, complete = false, size = null) {
        const s = kind === 'town_center' ? 4 : 1;
        const [w, h] = size || [s, s];
        const b = new FBuilding(kind, pid, tx, ty, w, h);
        for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) this.occ[y][x] = b;
        this.buildings.push(b);
        return b;
    }
}

// maps mock (from the fixture: MAPS water / nomad flags)
const REF = JSON.parse(fs.readFileSync(new URL('./fixtures/G5-map_ref.json', import.meta.url), 'utf8'));
export function is_water(mt) { return (REF.maps[mt] || REF.maps.land)[0]; }
export function is_nomad(mt) { return (REF.maps[mt] || [false, false])[1]; }
