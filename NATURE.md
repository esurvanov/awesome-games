# 🌲 NATURE — ели, камни, следы, тундра, звери

Files: `modules/vegetation.js` · `modules/terrain.js` · `open-world.html` (fox / stag loaders only) · `assets/pack/rock_ph_*.js` · `tools/pack-rocks.mjs`.
Status: work in progress — numbers and before/after images are filled in below as each piece is verified.

## ⚡ Forest fps: why the two harnesses disagreed

| Harness | Build | Forest fps | Why |
|---|---|---|---|
| compare page (cold browser profile, vsync) | bc0f0a0 | 8.6–10 | every tree/terrain shader compiles in the measured seconds (no shader cache) |
| same script, warm profile (vsync) | bc0f0a0 | 15–20 | shader cache warm |
| stand / TEXUNITS (warm, uncapped) | bc0f0a0 | ≈ 23 ms | warm + no vsync steps |
| compare page, working tree | HEAD + LOWEND | 30 | `LowEnd.warm()` precompiles every material on `setQuality` |

vsync in headless snaps to 60 / 30 / 20 / 15 / 12 / 10 / 8.6: one slow frame per two halves the number.
