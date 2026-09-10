# Lost Orbit

Framework-agnostic TypeScript library for the 404 Lost Orbit scene: voxel factory, scan beam, fighter departure, portal transit, and grid runners. No React / Next.js.

```ts
import { mountLostOrbit } from 'lost-orbit'
import 'lost-orbit/style.css'

const stop = mountLostOrbit(document.querySelector('#app')!, {
  stationLabel: 'Home',
  onStation: () => history.back(),
})
```

## Modules

| Import | Role |
|---|---|
| `lost-orbit/layout` | 404 voxel map and camera framing |
| `lost-orbit/flight` | Takeoff path, scan fan, pilot / afterburner / barrel |
| `lost-orbit/craft` | Fighter and freighter meshes |
| `lost-orbit/effects` | Exhaust, wing trails, explosions |
| `lost-orbit/transit` | NPC ships through the portal |
| `lost-orbit/runners` | 2D grid-runner field + `mountGridRunners` |
| `lost-orbit/scene` | `mountAbsentFactory`, `mountLostOrbit` |
| `lost-orbit/tuner` | Optional `?portalDebug=1` tilt panel |

Peer dependency: `three@^0.180`.

## Preview

```bash
pnpm install
pnpm dev
```

Opens `preview/index.html`. Each page is a standalone HTML template for one module.
