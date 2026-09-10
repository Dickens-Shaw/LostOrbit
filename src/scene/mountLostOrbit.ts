import { mountAbsentFactory, type AbsentFactoryOptions } from './absentFactoryScene'
import { mountGridRunners, type GridRunnersMountOptions } from '../runners/gridRunnersMount'

export type LostOrbitOptions = Partial<AbsentFactoryOptions> & GridRunnersMountOptions & {
  copy?: { kicker?: string; title?: string; body?: string }
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 一页挂上巡航背景 + 404 工厂场景。host 只需要是普通 DOM 节点。
 */
export function mountLostOrbit(host: HTMLElement, options: LostOrbitOptions = {}): () => void {
  host.classList.add('lost-orbit-shell')
  document.body.classList.add('lost-orbit-grid')

  const runnersHost = document.createElement('div')
  const sceneHost = document.createElement('div')
  sceneHost.className = 'absent-factory'
  host.append(runnersHost, sceneHost)

  const stopRunners = mountGridRunners(runnersHost, options)
  const stopScene = mountAbsentFactory(sceneHost, {
    reducedMotion: options.reducedMotion ?? prefersReducedMotion(),
    stationLabel: options.stationLabel ?? 'Home',
    onStation: options.onStation,
    rayCount: options.rayCount,
  })

  return () => {
    stopScene()
    stopRunners()
    document.body.classList.remove('lost-orbit-grid')
    runnersHost.remove()
    sceneHost.remove()
  }
}
