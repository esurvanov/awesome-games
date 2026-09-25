(() => { const out = [];
  const sim = (setup, sec, react, missP) => { newGame(); state = 'play'; input.mx = input.my = 0; setup(); let near = 0, bites = 0, hp0 = 100, t = 0, dead = null;
    while (t < sec) { update(0.05); t += 0.05; G.s.warm = Math.max(G.s.warm, 60);
      if (G.s.hp < hp0 - 5) bites++; hp0 = G.s.hp;
      if (state !== 'play') { dead = G.cause + '@' + t.toFixed(0); break; }
      const w = nearest(G.wolves, 58); if (w) near += 0.05; else near = 0;
      if (w && near >= react && G.p.cd <= 0 && Math.random() > missP) interact(true);
    }
    state = 'play'; return `укусов ${bites}, hp ${G.s.hp.toFixed(0)}, убито ${G.stats.wolves}, ${dead || 'жив'}`; };
  const field = () => { G.chapter = 2; G.day = 3; G.time = tAt(3, 22); G.lastDawn = 3; G.p.x = 1100; G.p.y = 2900; G.D.phase = 'relax'; G.D.calmT = 1e9; G.fired.E5 = 1; };
  for (const [react, miss] of [[0.3, 0.3], [0.5, 0.5]]) {
    let r = []; for (let i = 0; i < 5; i++) r.push(sim(() => { field(); spawnPack(4, false); }, 60, react, miss));
    out.push(`стая 4 в поле, реакция ${react}с, промах ${miss * 100}%: ` + r.join(' | '));
    r = []; for (let i = 0; i < 5; i++) r.push(sim(() => { field(); G.fired.E5 = 0; G.time = tAt(3, 20.99); }, 90, react, miss));
    out.push(`осада 4+вожак в поле, реакция ${react}с, промах ${miss * 100}%: ` + r.join(' | '));
  }
  return out.join('\n'); })()
