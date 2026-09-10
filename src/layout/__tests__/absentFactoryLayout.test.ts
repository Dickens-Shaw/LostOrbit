import { expect, test } from 'vitest'
import { buildFactoryVoxels, CHAR_MAPS, isChamferedOut, planFactoryFrame, VOXEL_ON_COUNT } from '../absentFactoryLayout'

test('工厂 404 用 7×9 双层体素，并切掉倒角格', () => {
  expect(CHAR_MAPS['4']).toHaveLength(9)
  expect(CHAR_MAPS['0'][0]).toHaveLength(7)
  expect(isChamferedOut('0', 0, 0)).toBe(true)
  expect(isChamferedOut('4', 1, 3)).toBe(true)

  const voxels = buildFactoryVoxels()
  expect(voxels).toHaveLength(VOXEL_ON_COUNT)
  expect(voxels.some((voxel) => voxel.layer === 1)).toBe(true)
  expect(new Set(voxels.map((voxel) => voxel.digitIndex)).size).toBe(3)
})

test('竖屏构图会拉远相机，404 半宽落在视锥里', () => {
  const phone = planFactoryFrame(390, 844)
  const desktop = planFactoryFrame(1440, 900)
  expect(phone.distance).toBeGreaterThan(desktop.distance)
  expect(phone.stageY).toBeGreaterThan(desktop.stageY)
  expect(phone.far).toBeGreaterThan(phone.distance)
  const tan = Math.tan((36 * Math.PI) / 360)
  expect(tan * phone.distance * phone.aspect).toBeGreaterThanOrEqual(7.8)
  expect(phone.stationX).toBeLessThan(-5.2)
  expect(phone.stationX).toBeGreaterThan(-6.4)
  expect(phone.stationY).toBeGreaterThan(desktop.stationY)
})
