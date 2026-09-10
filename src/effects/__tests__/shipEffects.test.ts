import * as THREE from 'three'
import { describe, expect, test } from 'vitest'
import {
  EXPLOSION,
  createExhaustPlume,
  createShipExplosion,
  createWingTrail,
  explosionProfile,
  plumeProfileForSpeed,
  puffLayout,
  ribbonIndices,
  trailProfileForSpeed,
  writeRibbon,
} from '../shipEffects'

describe('速度驱动的尾焰 / 尾迹形态', () => {
  test('尾焰越快越长、越宽、流得越快、越亮；静止只剩微弱余火', () => {
    const idle = plumeProfileForSpeed(0)
    const half = plumeProfileForSpeed(0.5)
    const full = plumeProfileForSpeed(1)
    expect(idle.intensity).toBeLessThan(0.15)
    expect(full.intensity).toBe(1)
    expect(full.length).toBeGreaterThan(half.length)
    expect(half.length).toBeGreaterThan(idle.length)
    expect(full.width).toBeGreaterThan(idle.width)
    expect(full.flow).toBeGreaterThan(idle.flow)
    expect(plumeProfileForSpeed(1.6).length).toBeGreaterThan(full.length)
    expect(plumeProfileForSpeed(2).length).toBe(plumeProfileForSpeed(1.65).length)
  })

  test('辉光片沿尾焰排布：喷口处最亮，尾端透明且落在尾焰长度内', () => {
    const profile = plumeProfileForSpeed(0.8)
    const head = puffLayout(0, profile)
    const mid = puffLayout(0.5, profile)
    const tail = puffLayout(1, profile)
    expect(head.along).toBe(0)
    expect(tail.along).toBeCloseTo(profile.length)
    expect(head.alpha).toBeGreaterThan(mid.alpha)
    expect(tail.alpha).toBe(0)
    expect(mid.size).toBeGreaterThan(0)
  })

  test('尾迹越快越长、越宽、越亮', () => {
    const slow = trailProfileForSpeed(0.1)
    const fast = trailProfileForSpeed(1)
    expect(fast.length).toBeGreaterThan(slow.length)
    expect(fast.width).toBeGreaterThan(slow.width)
    expect(fast.opacity).toBeGreaterThan(slow.opacity)
  })
})

describe('面向相机的带状尾迹', () => {
  test('头部达到给定宽度、尾端收尖、带面垂直于视线，颜色从尾到头由黑渐亮', () => {
    const points = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0])
    const out = { positions: new Float32Array(4 * 6), colors: new Float32Array(4 * 6) }
    const vertices = writeRibbon(points, 4, { x: 1.5, y: 5, z: 0 }, 0.2, [1, 0.8, 0.5], [0, 0, 0], out)
    expect(vertices).toBe(8)
    // 尾端两顶点重合（宽 0）。
    expect(out.positions[0]).toBeCloseTo(out.positions[3]!)
    expect(out.positions[2]).toBeCloseTo(out.positions[5]!)
    // 头部两顶点相距 0.2，且沿 z 展开（航迹沿 x、相机在 +y，side = x × y = z）。
    const hx = out.positions[18]! - out.positions[21]!
    const hy = out.positions[19]! - out.positions[22]!
    const hz = out.positions[20]! - out.positions[23]!
    expect(Math.hypot(hx, hy, hz)).toBeCloseTo(0.2)
    expect(Math.abs(hz)).toBeCloseTo(0.2)
    expect(Math.abs(hx)).toBeLessThan(1e-6)
    expect(out.colors[0]).toBe(0)
    expect(out.colors[18]).toBeCloseTo(1)
    expect(out.colors[19]).toBeCloseTo(0.8)
  })

  test('少于两个点不写顶点；索引每段两个三角形', () => {
    const out = { positions: new Float32Array(6), colors: new Float32Array(6) }
    expect(writeRibbon(new Float32Array([0, 0, 0]), 1, { x: 0, y: 1, z: 0 }, 0.1, [1, 1, 1], [0, 0, 0], out)).toBe(0)
    const indices = ribbonIndices(4)
    expect(indices).toHaveLength(18)
    expect(Array.from(indices.slice(0, 6))).toEqual([0, 1, 2, 1, 3, 2])
    expect(Math.max(...indices)).toBe(7)
  })

  test('尾迹对象：补点、按速度裁长、可见性跟随亮度，减速后点数收缩', () => {
    const trail = createWingTrail(32)
    const camera = new THREE.Vector3(0, 5, 0)
    for (let i = 0; i < 20; i += 1) trail.push(i * 0.3, 0, 0)
    expect(trail.count).toBe(20)
    trail.update(camera, trailProfileForSpeed(1), 1)
    expect(trail.count).toBe(20)
    expect(trail.group.children.every((child) => child.visible)).toBe(true)
    trail.update(camera, trailProfileForSpeed(0), 1)
    expect(trail.count).toBeLessThan(5)
    trail.update(camera, trailProfileForSpeed(1), 0)
    expect(trail.group.children.every((child) => !child.visible)).toBe(true)
    trail.reset()
    expect(trail.count).toBe(0)
    trail.dispose()
  })

  test('尾焰对象：速度为 0 且熄灭时隐藏，加速后可见并沿 -z 拉长', () => {
    const plume = createExhaustPlume({ x: 0, y: 0, z: -0.5, radius: 0.05 }, null)
    expect(plume.group.position.z).toBe(-0.5)
    plume.update(0.016, plumeProfileForSpeed(1), 0)
    expect(plume.group.visible).toBe(false)
    plume.update(0.016, plumeProfileForSpeed(1), 1)
    expect(plume.group.visible).toBe(true)
    // 径向 scale 是相对喷口半径的无量纲系数，轴向 scale 是绝对长度：全速时长度远大于实际半径。
    const core = plume.group.children[0]!
    expect(core.scale.z).toBeGreaterThan(core.scale.x * 0.05 * 6)
    const slow = createExhaustPlume({ x: 0, y: 0, z: -0.5, radius: 0.05 }, null)
    slow.update(0.016, plumeProfileForSpeed(0.2), 1)
    expect(slow.group.children[0]!.scale.z).toBeLessThan(core.scale.z)
    slow.dispose()
    const sprites = plume.group.children.filter((child) => child instanceof THREE.Sprite)
    expect(sprites.length).toBeGreaterThan(5)
    expect(sprites.every((sprite) => sprite.position.z <= 0.0001)).toBe(true)
    plume.reset()
    expect(plume.group.visible).toBe(false)
    plume.dispose()
  })
})

describe('撞机爆炸', () => {
  test('闪光快起快落，火星与碎片随时间衰减到结束', () => {
    expect(explosionProfile(0).flash).toBe(0)
    expect(explosionProfile(EXPLOSION.flashPeak).flash).toBeCloseTo(1)
    expect(explosionProfile(0.6).flash).toBe(0)
    expect(explosionProfile(0.2).spark).toBeGreaterThan(explosionProfile(1).spark)
    expect(explosionProfile(0.2).debris).toBeGreaterThan(explosionProfile(1.2).debris)
    expect(explosionProfile(EXPLOSION.duration).done).toBe(true)
  })

  test('trigger 后可见、火星向外飞散，播完自动隐藏', () => {
    const explosion = createShipExplosion(new THREE.Texture(), new THREE.MeshStandardMaterial())
    expect(explosion.group.visible).toBe(false)
    const origin = new THREE.Vector3(2, 1, -3)
    explosion.trigger(origin, new THREE.Vector3(0, 0, -1))
    expect(explosion.active).toBe(true)
    explosion.update(0.3)
    expect(explosion.group.visible).toBe(true)
    const sparks = explosion.group.children.find((child): child is THREE.Points => child instanceof THREE.Points)!
    const positions = sparks.geometry.getAttribute('position') as THREE.BufferAttribute
    let spread = 0
    for (let i = 0; i < positions.count; i += 1) {
      spread = Math.max(spread, Math.hypot(positions.getX(i) - origin.x, positions.getY(i) - origin.y, positions.getZ(i) - origin.z))
    }
    expect(spread).toBeGreaterThan(0.3)
    explosion.update(EXPLOSION.duration)
    expect(explosion.active).toBe(false)
    expect(explosion.group.visible).toBe(false)
    explosion.dispose()
  })
})
