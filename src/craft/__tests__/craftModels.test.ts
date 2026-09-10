import * as THREE from 'three'
import { describe, expect, test } from 'vitest'
import { buildFighter, buildFreighter, FIGHTER_EXHAUSTS, FIGHTER_WINGTIP } from '../craftModels'

function materials() {
  return {
    hull: new THREE.MeshStandardMaterial(),
    trim: new THREE.MeshStandardMaterial(),
    glow: new THREE.MeshBasicMaterial(),
  }
}

function bounds(group: THREE.Group) {
  group.updateMatrixWorld(true)
  return new THREE.Box3().setFromObject(group)
}

describe('积木飞船模型', () => {
  test('战机：机头发射点在最前端，翼展宽于机身，尾喷口在最后端', () => {
    const group = new THREE.Group()
    const { emitter } = buildFighter(group, materials())
    const box = bounds(group)
    expect(group.children.length).toBeGreaterThan(18)
    expect(emitter.position.z).toBeCloseTo(box.max.z, 1)
    expect(box.max.x).toBeGreaterThan(0.55)
    expect(box.min.x).toBeLessThan(-0.55)
    expect(Math.abs(box.max.x + box.min.x)).toBeLessThan(0.02)
    // 翼尖常量与实际翼尖吻合；三个喷口都在机尾、且和三处发光喷口一一对应。
    expect(FIGHTER_WINGTIP.x).toBeLessThanOrEqual(box.max.x)
    expect(FIGHTER_WINGTIP.x).toBeGreaterThan(box.max.x - 0.12)
    expect(FIGHTER_EXHAUSTS).toHaveLength(3)
    const glows = group.children.filter(
      (child) => child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial && child.position.z < 0,
    ) as THREE.Mesh[]
    expect(glows).toHaveLength(3)
    for (const exhaust of FIGHTER_EXHAUSTS) {
      const match = glows.find((mesh) => Math.abs(mesh.position.x - exhaust.x) < 0.01 && Math.abs(mesh.position.y - exhaust.y) < 0.01)
      expect(match).toBeDefined()
      expect(exhaust.z).toBeLessThanOrEqual(match!.position.z)
      expect(exhaust.z).toBeGreaterThan(match!.position.z - 0.04)
    }
  })

  test('运输船：驾驶舱偏在右侧（-x）最前端，尾部一对发动机舱在最后端', () => {
    const group = new THREE.Group()
    const { emitter } = buildFreighter(group, materials())
    const box = bounds(group)
    expect(group.children.length).toBeGreaterThan(14)
    expect(emitter.position.x).toBeLessThan(-0.15)
    expect(emitter.position.z).toBeCloseTo(box.max.z, 1)
    const glows = group.children.filter((child) => child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial) as THREE.Mesh[]
    const exhausts = glows.filter((mesh) => mesh.position.z < -0.5)
    expect(exhausts).toHaveLength(2)
    expect(exhausts[0]!.position.x).toBeCloseTo(-exhausts[1]!.position.x)
    // 扁宽：宽度大于高度两倍。
    expect(box.max.x - box.min.x).toBeGreaterThan((box.max.y - box.min.y) * 2)
  })
})
