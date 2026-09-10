import { expect, test } from 'vitest'
import { mountPortalTuner } from '../portalTuner'

const defaults = { x: -0.18, y: 1.32, z: 0.72, hoverX: -0.06, hoverY: 0.88, hoverZ: 0.28 }

test('传送门调参面板能改倾斜并复制常量', () => {
  const handle = mountPortalTuner(defaults, { x: -5.6, y: 3.4 })
  const panel = document.querySelector('[data-testid="portal-tuner"]')
  expect(panel).toBeTruthy()

  const slider = panel?.querySelector('input[data-key="z"]') as HTMLInputElement
  slider.value = '0.55'
  slider.dispatchEvent(new Event('input', { bubbles: true }))
  expect(handle.tilt.z).toBeCloseTo(0.55)

  handle.update({
    rotX: 0.1,
    rotY: 1.2,
    rotZ: 0.55,
    hover: 0.4,
    stationX: -5.6,
    stationY: 3.4,
  })
  expect(panel?.textContent).toContain('0.550')

  handle.dispose()
  expect(document.querySelector('[data-testid="portal-tuner"]')).toBeNull()
})
