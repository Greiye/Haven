# Haven

A first-person walk through a procedurally generated medieval valley, rendered live in the browser with Three.js (WebGL2). There are no downloaded models or textures: terrain, buildings, trees, materials, sky and sound are all generated in code.

**Play:** https://greiye.github.io/Haven/ (after enabling GitHub Pages, see below)

## What is in the world
- **Haven**: a walled market town with about 150 timber-framed houses, a church, two gates, a fountain square and market stalls. Windows light up at night.
- **Thornwood**: dense oak and pine forest under snow-capped peaks that ring the valley.
- **Mirror Pond**: one small pond with a dock, a rowboat, a fisher's hut, reeds and lily pads.
- **Townsfolk**: flat 2D silhouettes in four outline shapes (man, woman, child, hooded traveller with a staff). Each is black at the head and fades to transparent at the feet. They walk the road network from place to place, pausing at ends and crossroads.

## Graphics
- 1024² procedural heightfield, chunked terrain with shader splatting (grass, dirt, rock by slope, pond bank, cobble, snow)
- Up to 700k GPU-instanced grass blades with wind and player interaction
- Leaf-card trees, instanced rocks, procedural PBR-style materials (colour + normal maps generated at load)
- Preetham sky with image-based lighting, procedural clouds, stars and moon, time-of-day control
- Planar-reflection water for the pond with depth colour and shoreline foam
- Post: HDR, MSAA, ground-truth ambient occlusion, screen-space sun shafts, bloom, ACES tone mapping, grading
- Adaptive resolution keeps the frame rate up on weaker devices; quality defaults to Low or Medium on phones

## Controls
| | Desktop | Phone / tablet | Gamepad |
|---|---|---|---|
| Move | WASD / arrows | Drag on the left half (floating stick) | Left stick |
| Look | Mouse | Drag on the right half | Right stick |
| Run | Shift | » button | B, LT/RT or L3 |
| Jump | Space | ↑ button | A |
| Travel | 1–5 | Go button | LB / RB |
| Sun | T / G or the Hour slider | | D-pad left / right |
| Sound | M | | Y |
| Pause / start | Esc | | Start (A on the title card) |

## Host it on GitHub Pages
1. Push this repo to GitHub (it is already built: `app.js` is the bundled game).
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Open `https://<your-user>.github.io/<repo>/`.

All paths are relative, so it also works from any sub-folder or static host.

## Install as an app (PWA)
- **Android / desktop Chrome and Edge:** open the page and use the **Install app** button on the title card (or the browser's install icon).
- **iOS Safari:** Share → **Add to Home Screen**. It then launches full screen.
- After the first load the game is cached and works offline.

## Develop
```bash
npm install
npm run build   # bundles src/main.js (+ three) into app.js
npm run serve   # http://localhost:8080
```
Requires a WebGL2 browser. Three.js (MIT) is bundled into `app.js` via esbuild.

## Credits
Rendering techniques follow public Three.js showcase work: [Codrops fluffy grass](https://tympanus.net/codrops/2025/02/04/how-to-make-the-fluffiest-grass-with-three-js/), [al-ro grass](https://al-ro.github.io/projects/grass), the [three.js showcase forum](https://discourse.threejs.org/c/showcase/7). All assets are original and generated.


