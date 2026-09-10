import * as THREE from 'three'
import { expect, test } from 'vitest'
import {
  inboundFromCamera,
  spawnTransitPose,
  createPortalTransit,
  createTransitCraft,
  randomIntegerScaleMultiplier,
  scaleForKind,
  spawnLanePose,
  findTransitCollision,
  enforceLaneFollowing,
  laneDepthFree,
  laneGap,
  laneScaleMultiplier,
  IDLE_SCALE_MULTIPLIER,
  KIND_RADIUS,
  PORTAL_TRANSIT_IDLE,
  TRANSIT_LANE,
} from '../portalTransit'

test('飞船从相机一侧生成，沿法线飞向门面', () => {
  const inbound = -1
  const pose = spawnTransitPose(inbound, () => 0.25)
  expect(pose.z).toBeGreaterThan(0)
  expect(pose.speed).toBeGreaterThan(0)

  const portal = new THREE.Group()
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 0, 8)
  portal.updateMatrixWorld()
  expect(inboundFromCamera(portal, camera, new THREE.Vector3())).toBe(-1)
})

test('不悬停也会穿门，数量更少', () => {
  const portal = new THREE.Group()
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 0, 8)
  const glowMap = new THREE.Texture()
  const transit = createPortalTransit({
    portal,
    camera,
    glowMap,
    makeMaterials: () => ({
      hull: new THREE.MeshStandardMaterial(),
      trim: new THREE.MeshStandardMaterial(),
      glow: new THREE.MeshBasicMaterial(),
    }),
  })

  transit.tick(0.5, false, false)
  expect(portal.children.some((child) => child.visible)).toBe(true)

  for (let i = 0; i < 12; i += 1) transit.tick(0.05, false, false)
  const idleLive = portal.children.filter((child) => child.type === 'Group' && child.visible).length
  expect(idleLive).toBeGreaterThan(0)
  expect(idleLive).toBeLessThanOrEqual(PORTAL_TRANSIT_IDLE)

  transit.dispose()
  expect(portal.children).toHaveLength(0)
})

test('穿门飞船有多种外形，货船明显大于探针', () => {
  const hull = new THREE.MeshBasicMaterial()
  const probe = createTransitCraft('probe', hull, hull, hull)
  const hauler = createTransitCraft('hauler', hull, hull, hull)
  expect(probe.children.length).toBeGreaterThan(2)
  expect(hauler.children.length).toBeGreaterThan(probe.children.length)
  expect(scaleForKind('hauler', () => 0)).toBeGreaterThan(scaleForKind('probe', () => 1))
})

test('每艘穿门飞船获得 1 至 3 的随机整数尺寸倍率', () => {
  expect(randomIntegerScaleMultiplier(() => 0)).toBe(IDLE_SCALE_MULTIPLIER[0])
  expect(randomIntegerScaleMultiplier(() => 0.999999)).toBe(IDLE_SCALE_MULTIPLIER[1])
})

test('生成飞船姿态时把整数倍率应用到机型基础尺寸', () => {
  const randomValues = [0, 0, 0, 0.999999, 0]
  const pose = spawnTransitPose(-1, () => randomValues.shift() ?? 0, 'scout')
  expect(pose.scale).toBeCloseTo(0.16 * IDLE_SCALE_MULTIPLIER[1])
})

test('航道生成：走指定轨道、指定深度，慢速，倍率按机型区分', () => {
  const pose = spawnLanePose(-1, () => 0, 'scout', 3.5, 1)
  expect(pose.z).toBeCloseTo(3.5)
  expect(pose.x).toBe(TRANSIT_LANE.slots[1]!.x)
  expect(pose.y).toBe(TRANSIT_LANE.slots[1]!.y)
  expect(pose.speed).toBeLessThan(0.5)
  expect(pose.scale).toBeCloseTo(0.16 * TRANSIT_LANE.scaleMultiplier.scout[0])
  expect(pose.radius).toBeCloseTo(KIND_RADIUS.scout * pose.scale)
  // 货船倍率区间高于小船
  expect(laneScaleMultiplier('hauler', () => 0)).toBeGreaterThan(laneScaleMultiplier('probe', () => 0))
  expect(laneScaleMultiplier('probe', () => 0.999)).toBe(TRANSIT_LANE.scaleMultiplier.probe[1])
})

test('航道间距：深度差不足两者半径之和加余量就不能放；后车追上前车会被按住', () => {
  const occupied = [{ depth: 3, radius: 0.5 }]
  expect(laneDepthFree(3 + laneGap(0.5, 0.3) - 0.01, 0.3, occupied)).toBe(false)
  expect(laneDepthFree(3 + laneGap(0.5, 0.3), 0.3, occupied)).toBe(true)
  const ships = [
    { depth: 2, radius: 0.4 },
    { depth: 2.3, radius: 0.4 }, // 追得太近
    { depth: 6, radius: 0.6 },
  ]
  const fixed = enforceLaneFollowing(ships)
  expect(fixed[0]).toBe(2)
  expect(fixed[1]).toBeCloseTo(2 + laneGap(0.4, 0.4))
  expect(fixed[2]).toBe(6)
})

test('碰撞判定：机身球与最近的船相交才算撞上', () => {
  const colliders = [
    { index: 0, x: 0, y: 0, z: 5, radius: 0.5 },
    { index: 3, x: 1, y: 0, z: 5, radius: 0.5 },
  ]
  expect(findTransitCollision({ x: 0, y: 0, z: 5.8 }, colliders, 0.2)).toBe(-1)
  expect(findTransitCollision({ x: 0.1, y: 0, z: 5.4 }, colliders, 0.2)).toBe(0)
  expect(findTransitCollision({ x: 0.9, y: 0, z: 5.3 }, colliders, 0.2)).toBe(3)
})

test('航道模式：一进入就铺好一队，可查询碰撞体，撞爆后从碰撞体里消失', () => {
  const portal = new THREE.Group()
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(0, 0, 8)
  const transit = createPortalTransit({
    portal,
    camera,
    glowMap: new THREE.Texture(),
    makeMaterials: () => ({
      hull: new THREE.MeshStandardMaterial(),
      trim: new THREE.MeshStandardMaterial(),
      glow: new THREE.MeshBasicMaterial(),
    }),
  })
  const spawnDepth = 8
  transit.tick(0.016, false, false, { depth: spawnDepth, avoid: { x: 0, y: 0, z: 30 } })
  const colliders = transit.colliders()
  expect(colliders.length).toBeGreaterThanOrEqual(3)
  // 都在相机这一侧（z > 0）、不超过生成点，前后间距 ≥ 两者半径之和 + 余量，各走不同轨道。
  const sorted = [...colliders].sort((a, b) => a.z - b.z)
  expect(sorted[0]!.z).toBeGreaterThan(0)
  expect(sorted[sorted.length - 1]!.z).toBeLessThanOrEqual(spawnDepth + 1e-6)
  for (let i = 1; i < sorted.length; i += 1) {
    expect(sorted[i]!.z - sorted[i - 1]!.z).toBeGreaterThanOrEqual(laneGap(sorted[i]!.radius, sorted[i - 1]!.radius) - 1e-6)
  }
  const tracks = new Set(colliders.map((c) => `${c.x},${c.y}`))
  expect(tracks.size).toBe(colliders.length)
  // 多跑几秒，跟车修正下间距始终不重叠
  for (let i = 0; i < 120; i += 1) transit.tick(0.05, false, false, { depth: spawnDepth })
  const later = [...transit.colliders()].sort((a, b) => a.z - b.z)
  for (let i = 1; i < later.length; i += 1) {
    expect(later[i]!.z - later[i - 1]!.z).toBeGreaterThanOrEqual(laneGap(later[i]!.radius, later[i - 1]!.radius) - 1e-6)
  }
  const kinds = new Set(portal.children.filter((child) => child.type === 'Group' && child.visible).map((child) => child.children.length))
  expect(kinds.size).toBeGreaterThan(1)

  const target = later[0]!.index
  transit.explode(target)
  expect(transit.colliders().some((c) => c.index === target)).toBe(false)
  transit.dispose()
})
