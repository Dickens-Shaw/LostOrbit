import * as THREE from 'three'
import { buildFighter, buildFreighter } from '../craft/craftModels'
import type { Point3 } from '../core/types'

export const PORTAL_TRANSIT_MAX = 4
export const PORTAL_TRANSIT_IDLE = 2
export const PORTAL_TRANSIT_POOL = 8
export const TRANSIT_KINDS = ['probe', 'needle', 'scout', 'delta', 'hauler'] as const
export type TransitKind = (typeof TRANSIT_KINDS)[number]

/** 各机型的基础尺寸区间（倍率另算）。 */
const KIND_SCALE: Record<TransitKind, [number, number]> = {
  probe: [0.07, 0.1], // 侦察舰
  needle: [0.1, 0.15], // 针尖战机
  scout: [0.16, 0.22], // 侦查舰
  delta: [0.15, 0.21], // 三角战机
  hauler: [0.26, 0.36], // 货运舰
}

/**
 * 驾驶阶段的进港航道（门局部单位，门面朝玩家来向为 +z）：
 * - 生成点固定在"玩家接手点 → 门心"路程的 spawnFraction 处（场景换算成门局部深度传进来）；
 * - 每艘船占一条横向轨道（slots），轨道彼此平行、互不相交；
 * - 同一时刻任意两艘船的深度差 ≥ 两者碰撞半径之和 + gapMargin，后车追上前车就跟车，永不重叠；
 * - 尺寸倍率按机型给：小船 2~4 倍，战机 2~3 倍，货船 3~4 倍（货船基础尺寸本来就大）。
 */
export const TRANSIT_LANE = {
  cap: 7,
  spawnFraction: 0.75,
  speed: [0.16, 0.26],
  slots: [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.18 },
    { x: -0.5, y: 0.18 },
    { x: 0.28, y: -0.34 },
    { x: -0.28, y: -0.34 },
    { x: 0, y: 0.46 },
    { x: 0.62, y: -0.1 },
    { x: -0.62, y: -0.1 },
  ],
  gapMargin: 0.35,
  spawnGap: [1.6, 2.8],
  scaleMultiplier: {
    probe: [2, 4],
    needle: [2, 4],
    delta: [2, 3],
    scout: [2, 3],
    hauler: [3, 4],
  } as Record<TransitKind, readonly [number, number]>,
  /** 玩家（门局部坐标）这个半径内不生成新船，避免船凭空出现在机头前。 */
  avoidRadius: 1.8,
  /** 铺种子队列时门前这个深度以内不再放船。 */
  seedMinDepth: 0.8,
} as const

/** 两艘船在航道里允许的最小深度差。 */
export function laneGap(radiusA: number, radiusB: number) {
  return radiusA + radiusB + TRANSIT_LANE.gapMargin
}

/** 各机型的碰撞半径（机体基础尺寸下），乘上 scale 就是门局部空间里的半径。 */
export const KIND_RADIUS: Record<TransitKind, number> = {
  probe: 0.14,
  needle: 0.5,
  scout: 0.55,
  delta: 0.36,
  hauler: 0.62,
}

/** 航道里可能出现的最大碰撞半径（货船最大尺寸 × 最大倍率），铺初始队列时用它留间距。 */
export const LANE_MAX_RADIUS = KIND_RADIUS.hauler * KIND_SCALE.hauler[1] * TRANSIT_LANE.scaleMultiplier.hauler[1]

export type TransitCollider = { index: number; x: number; y: number; z: number; radius: number }

/** 返回机身球与哪一艘船相交（索引），没碰到返回 -1。 */
export function findTransitCollision(ship: Point3, colliders: readonly TransitCollider[], shipRadius: number): number {
  let hit = -1
  let closest = Infinity
  for (const collider of colliders) {
    const distance = Math.hypot(ship.x - collider.x, ship.y - collider.y, ship.z - collider.z)
    const limit = shipRadius + collider.radius
    if (distance < limit && distance < closest) {
      closest = distance
      hit = collider.index
    }
  }
  return hit
}

export type TransitMaterials = {
  hull: THREE.MeshStandardMaterial
  trim: THREE.MeshStandardMaterial
  glow: THREE.MeshBasicMaterial
}

type Rider = {
  kind: TransitKind
  craft: THREE.Group
  hull: THREE.Material
  trim: THREE.Material
  glow: THREE.Material
  ribbonA: THREE.Mesh
  ribbonB: THREE.Mesh
  ribbonMat: THREE.MeshBasicMaterial
  core: THREE.Mesh
  coreMat: THREE.MeshBasicMaterial
  sparks: THREE.Points
  sparkPos: THREE.BufferAttribute
  sparkVel: Float32Array
  sparkMat: THREE.PointsMaterial
  ring: THREE.Mesh
  ringMat: THREE.MeshBasicMaterial
  flash: THREE.Sprite
  flashMat: THREE.SpriteMaterial
  halo: THREE.Sprite
  haloMat: THREE.SpriteMaterial
  live: boolean
  dissolving: boolean
  /** 被玩家撞爆：原地炸开，不做进门时的拉伸压缩。 */
  exploding: boolean
  /** 航道模式生成的船：尺寸放大了很多，尾迹亮度相应压低，免得成了一排光柱。 */
  lane: boolean
  /** 航道轨道槽位与碰撞半径（门局部单位）。 */
  slot: number
  radius: number
  age: number
  dissolve: number
  x: number
  y: number
  z: number
  speed: number
  inbound: number
  scale: number
}

function fadeMaterial(material: THREE.Material, opacity: number) {
  material.transparent = true
  material.opacity = opacity
  material.needsUpdate = true
}

function easeOut(t: number) {
  return 1 - (1 - t) * (1 - t)
}

function pulse(t: number, start: number, peak: number, end: number) {
  if (t <= start || t >= end) return 0
  if (t < peak) return (t - start) / Math.max(0.0001, peak - start)
  return 1 - (t - peak) / Math.max(0.0001, end - peak)
}

export function inboundFromCamera(portal: THREE.Group, camera: THREE.Camera, scratch: THREE.Vector3): number {
  scratch.copy(camera.position)
  portal.worldToLocal(scratch)
  return scratch.z >= 0 ? -1 : 1
}

export function scaleForKind(kind: TransitKind, random = Math.random) {
  const [min, max] = KIND_SCALE[kind]
  return min + random() * (max - min)
}

/** 悬停/待机时穿门飞船的整数尺寸倍率范围（航道模式用 TRANSIT_LANE.scaleMultiplier）。 */
export const IDLE_SCALE_MULTIPLIER = [1, 3] as const

export function randomIntegerScaleMultiplier(random = Math.random) {
  const [min, max] = IDLE_SCALE_MULTIPLIER
  return min + Math.floor(random() * (max - min + 1))
}

export function spawnTransitPose(inbound: number, random = Math.random, kind: TransitKind = 'scout') {
  const radius = 0.16 + random() * 0.48
  const angle = random() * Math.PI * 2
  const scale = scaleForKind(kind, random) * randomIntegerScaleMultiplier(random)
  return {
    x: Math.cos(angle) * radius * 0.85 + inbound * 0.08,
    y: Math.sin(angle) * radius * 0.55,
    z: inbound * -(1.7 + random() * 1.3),
    speed: 0.72 + random() * 0.28 + (kind === 'probe' ? 0.18 : kind === 'hauler' ? -0.12 : 0),
    scale,
    kind,
  }
}

/** 航道模式按机型取整数倍率。 */
export function laneScaleMultiplier(kind: TransitKind, random = Math.random) {
  const [min, max] = TRANSIT_LANE.scaleMultiplier[kind]
  return min + Math.floor(random() * (max - min + 1))
}

/**
 * 航道生成：在给定深度、给定轨道上放一艘船。横向位置来自轨道槽位，不再随机散开；
 * 深度是否与其他船冲突由调用方按碰撞半径判断。
 */
export function spawnLanePose(inbound: number, random = Math.random, kind: TransitKind = 'scout', depth = 6, slot = 0) {
  const lane = TRANSIT_LANE.slots[slot % TRANSIT_LANE.slots.length]!
  const [minSpeed, maxSpeed] = TRANSIT_LANE.speed
  const scale = scaleForKind(kind, random) * laneScaleMultiplier(kind, random)
  return {
    x: lane.x,
    y: lane.y,
    z: inbound * -depth,
    speed: minSpeed + random() * (maxSpeed - minSpeed) + (kind === 'probe' ? 0.04 : kind === 'hauler' ? -0.04 : 0),
    scale,
    kind,
    slot: slot % TRANSIT_LANE.slots.length,
    radius: KIND_RADIUS[kind] * scale,
  }
}

/**
 * 一艘半径为 radius 的船能否放在 depth 处：与航道里每艘船的深度差都不小于两者半径之和加余量。
 * occupied 为现有船的 { depth, radius }。
 */
export function laneDepthFree(depth: number, radius: number, occupied: readonly { depth: number; radius: number }[]) {
  return occupied.every((other) => Math.abs(other.depth - depth) >= laneGap(radius, other.radius) - 1e-6)
}

/**
 * 跟车：按深度升序（离门近的在前）检查，后车与前车的深度差小于允许间距就把后车按住在前车后面。
 * 返回修正后的深度数组（与输入同序）。
 */
export function enforceLaneFollowing(ships: readonly { depth: number; radius: number }[]) {
  const order = ships.map((ship, index) => ({ ...ship, index })).sort((a, b) => a.depth - b.depth)
  const result = ships.map((ship) => ship.depth)
  for (let i = 1; i < order.length; i += 1) {
    const ahead = order[i - 1]!
    const current = order[i]!
    const minDepth = ahead.depth + laneGap(ahead.radius, current.radius)
    if (current.depth < minDepth) current.depth = minDepth
    result[current.index] = current.depth
  }
  return result
}

export function createTrailRibbonTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)
  ctx.clearRect(0, 0, 64, 256)
  for (let y = 0; y < 256; y += 1) {
    const along = y / 255
    const head = Math.pow(1 - along, 1.35)
    const width = 4 + (1 - along) * 22
    const glow = ctx.createLinearGradient(32 - width, y, 32 + width, y)
    glow.addColorStop(0, 'rgba(255,255,255,0)')
    glow.addColorStop(0.45, `rgba(255,255,255,${0.15 * head})`)
    glow.addColorStop(0.5, `rgba(255,255,255,${0.95 * head})`)
    glow.addColorStop(0.55, `rgba(255,255,255,${0.15 * head})`)
    glow.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, y, 64, 1)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

export function createTransitCraft(kind: TransitKind, hull: THREE.Material, trim: THREE.Material, glow: THREE.Material) {
  const craft = new THREE.Group()
  const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    mesh.position.set(x, y, z)
    craft.add(mesh)
    return mesh
  }

  if (kind === 'probe') {
    box(0.12, 0.12, 0.16, hull)
    box(0.06, 0.06, 0.1, trim, 0, 0, 0.12)
    box(0.16, 0.02, 0.08, hull, 0.08, 0, -0.02)
    box(0.16, 0.02, 0.08, hull, -0.08, 0, -0.02)
    box(0.05, 0.05, 0.06, glow, 0, 0, 0.2)
  } else if (kind === 'needle') {
    box(0.07, 0.06, 1.05, hull)
    box(0.05, 0.05, 0.22, trim, 0, 0, 0.58)
    box(0.32, 0.02, 0.14, hull, 0, 0, -0.08)
    box(0.04, 0.1, 0.1, hull, 0, 0.07, -0.36)
    box(0.04, 0.04, 0.08, glow, 0, 0, 0.72)
  } else if (kind === 'delta') {
    box(0.12, 0.08, 0.42, hull, 0, 0, 0.04)
    const wing = box(0.62, 0.03, 0.34, hull, 0, -0.01, -0.04)
    wing.rotation.y = 0.18
    box(0.14, 0.07, 0.16, trim, 0, 0.06, 0.08)
    box(0.08, 0.05, 0.12, glow, 0, 0, 0.3)
  } else if (kind === 'hauler') {
    buildFreighter(craft, { hull, trim, glow })
  } else {
    buildFighter(craft, { hull, trim, glow })
  }

  return craft
}

export function createPortalTransit({
  portal,
  camera,
  glowMap,
  makeMaterials,
}: {
  portal: THREE.Group
  camera: THREE.Camera
  glowMap: THREE.Texture
  makeMaterials: () => TransitMaterials
}) {
  const scratch = new THREE.Vector3()
  const riders: Rider[] = []
  const ribbonTex = createTrailRibbonTexture()
  let spawnWait = 0.35
  /** 进入航道模式的第一帧：清掉悬停期留下的小船，并一次性铺好一队。 */
  let laneSeeded = false
  const colliders: TransitCollider[] = []

  for (let i = 0; i < PORTAL_TRANSIT_POOL; i += 1) {
    const kind = TRANSIT_KINDS[i % TRANSIT_KINDS.length]!
    const mats = makeMaterials()
    mats.hull.transparent = true
    mats.hull.depthWrite = false
    mats.trim.transparent = true
    mats.trim.depthWrite = false
    const craft = createTransitCraft(kind, mats.hull, mats.trim, mats.glow)
    craft.visible = false
    craft.rotation.order = 'YXZ'
    portal.add(craft)

    const ribbonMat = new THREE.MeshBasicMaterial({
      map: ribbonTex,
      color: 0xc8a96b,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    const ribbonA = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ribbonMat)
    const ribbonB = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ribbonMat)
    ribbonA.visible = false
    ribbonB.visible = false
    portal.add(ribbonA, ribbonB)

    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xefe6cf,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    const core = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), coreMat)
    core.visible = false
    portal.add(core)

    const sparkCount = 22
    const sparkGeo = new THREE.BufferGeometry()
    const sparkPos = new THREE.BufferAttribute(new Float32Array(sparkCount * 3), 3)
    sparkGeo.setAttribute('position', sparkPos)
    const sparkMat = new THREE.PointsMaterial({
      map: glowMap,
      color: 0xc8a96b,
      size: 0.09,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const sparks = new THREE.Points(sparkGeo, sparkMat)
    sparks.visible = false
    sparks.frustumCulled = false
    portal.add(sparks)

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xc8a96b,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 36), ringMat)
    ring.visible = false
    portal.add(ring)

    const flashMat = new THREE.SpriteMaterial({
      map: glowMap,
      color: 0xefe6cf,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const haloMat = flashMat.clone()
    haloMat.color.set(0xc8a96b)
    const flash = new THREE.Sprite(flashMat)
    const halo = new THREE.Sprite(haloMat)
    flash.visible = false
    halo.visible = false
    portal.add(flash, halo)

    riders.push({
      kind,
      craft,
      hull: mats.hull,
      trim: mats.trim,
      glow: mats.glow,
      ribbonA,
      ribbonB,
      ribbonMat,
      core,
      coreMat,
      sparks,
      sparkPos,
      sparkVel: new Float32Array(sparkCount * 3),
      sparkMat,
      ring,
      ringMat,
      flash,
      flashMat,
      halo,
      haloMat,
      live: false,
      dissolving: false,
      exploding: false,
      lane: false,
      slot: -1,
      radius: 0,
      age: 0,
      dissolve: 0,
      x: 0,
      y: 0,
      z: 0,
      speed: 0.9,
      inbound: -1,
      scale: 0.2,
    })
  }

  const hide = (rider: Rider) => {
    rider.live = false
    rider.dissolving = false
    rider.exploding = false
    rider.craft.visible = false
    rider.ribbonA.visible = false
    rider.ribbonB.visible = false
    rider.core.visible = false
    rider.sparks.visible = false
    rider.ring.visible = false
    rider.flash.visible = false
    rider.halo.visible = false
    rider.flashMat.opacity = 0
    rider.haloMat.opacity = 0
    rider.sparkMat.opacity = 0
    rider.ringMat.opacity = 0
  }

  const burstSparks = (rider: Rider) => {
    const count = rider.sparkPos.count
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4
      const speed = 0.32 + Math.random() * 0.85
      rider.sparkVel[i * 3] = Math.cos(angle) * speed
      rider.sparkVel[i * 3 + 1] = Math.sin(angle) * speed
      rider.sparkVel[i * 3 + 2] = (Math.random() - 0.5) * (rider.exploding ? 0.9 : 0.2)
      rider.sparkPos.setXYZ(i, rider.x, rider.y, rider.z)
    }
    rider.sparkPos.needsUpdate = true
  }

  type Pose = ReturnType<typeof spawnTransitPose> & { slot?: number; radius?: number }

  const launch = (rider: Rider, inbound: number, pose: Pose = spawnTransitPose(inbound, Math.random, rider.kind), lane = false) => {
    rider.live = true
    rider.dissolving = false
    rider.exploding = false
    rider.lane = lane
    rider.slot = pose.slot ?? -1
    rider.radius = pose.radius ?? KIND_RADIUS[rider.kind] * pose.scale
    rider.age = 0
    rider.dissolve = 0
    rider.x = pose.x
    rider.y = pose.y
    rider.z = pose.z
    rider.speed = pose.speed
    rider.inbound = inbound
    rider.scale = pose.scale
    rider.craft.visible = true
    rider.ribbonA.visible = true
    rider.ribbonB.visible = true
    rider.core.visible = true
    rider.sparks.visible = false
    rider.ring.visible = false
    rider.flash.visible = false
    rider.halo.visible = false
    fadeMaterial(rider.hull, 1)
    fadeMaterial(rider.trim, 1)
    fadeMaterial(rider.glow, 0.95)
  }

  const paintTrail = (rider: Rider, fade: number, suck: number) => {
    const tail = ((1.05 + rider.scale * 2.4) * 2) / 3 * (1 - suck * 0.88)
    const width = (0.05 + rider.scale * 0.42) * (1 + suck * 0.35)
    const mid = rider.z - rider.inbound * tail * 0.48
    const flicker = 0.82 + Math.sin(rider.age * 16) * 0.18
    rider.ribbonA.position.set(rider.x, rider.y, mid)
    rider.ribbonB.position.copy(rider.ribbonA.position)
    rider.core.position.copy(rider.ribbonA.position)
    rider.ribbonA.scale.set(width, tail, 1)
    rider.ribbonB.scale.set(width, tail, 1)
    rider.core.scale.set(width * 0.22, tail * 0.92, 1)
    rider.ribbonA.rotation.set(Math.PI / 2, 0, 0)
    rider.ribbonB.rotation.set(Math.PI / 2, Math.PI / 2, 0)
    rider.core.rotation.set(Math.PI / 2, Math.PI / 4, 0)
    const dim = rider.lane ? 0.5 : 1
    rider.ribbonMat.opacity = (0.38 + 0.5 * fade) * flicker * dim
    rider.coreMat.opacity = (0.28 + 0.42 * fade) * flicker * dim
  }

  const paintRider = (rider: Rider) => {
    const { x, y, z, inbound, scale, dissolving, exploding, dissolve } = rider
    const compress = dissolving && !exploding ? easeOut(Math.min(1, dissolve / 0.32)) : 0
    const fade = dissolving
      ? Math.max(0, 1 - THREE.MathUtils.smoothstep(dissolve, exploding ? 0 : 0.12, exploding ? 0.18 : 0.52))
      : 1
    const burst = dissolving ? pulse(dissolve, exploding ? 0 : 0.04, exploding ? 0.12 : 0.22, 0.95) : 0
    rider.craft.position.set(x, y, z)
    rider.craft.scale.set(scale * (1 - compress * 0.88), scale * (1 - compress * 0.88), scale * (1 + compress * 3.6))
    rider.craft.rotation.set(0, inbound > 0 ? 0 : Math.PI, 0)
    fadeMaterial(rider.hull, fade)
    fadeMaterial(rider.trim, fade)
    fadeMaterial(rider.glow, 0.95 * fade)
    paintTrail(rider, fade, compress)

    if (!dissolving) {
      rider.flash.visible = false
      rider.halo.visible = false
      rider.ring.visible = false
      rider.sparks.visible = false
      return
    }

    rider.flash.visible = burst > 0.02
    rider.halo.visible = burst > 0.02
    rider.ring.visible = burst > 0.02
    rider.sparks.visible = burst > 0.02
    // 进门时在门面（z = 0）炸开；被撞爆时 z 就停在撞击点。
    rider.flash.position.set(x, y, z)
    rider.halo.position.set(x, y, z)
    rider.ring.position.set(x, y, z)
    const boost = exploding ? 1.6 : 1
    rider.flash.scale.setScalar((0.2 + burst * 1.05) * (0.7 + scale * 2) * boost)
    rider.halo.scale.setScalar((0.45 + burst * 1.7) * (0.7 + scale * 2) * boost)
    rider.flashMat.opacity = burst * 0.58
    rider.haloMat.opacity = burst * 0.32
    rider.ring.scale.setScalar(0.22 + easeOut(dissolve) * 1.35)
    rider.ringMat.opacity = burst * 0.36
    rider.sparkMat.opacity = burst * 0.52
    rider.sparkMat.size = 0.05 + burst * 0.06
  }

  const liveCount = () => riders.filter((rider) => rider.live).length
  /** 航道里还在飞（没进门、没爆）的船。 */
  const laneRiders = () => riders.filter((rider) => rider.live && rider.lane && !rider.dissolving)
  const laneOccupied = () => laneRiders().map((rider) => ({ depth: Math.abs(rider.z), radius: rider.radius }))
  /** 随机挑一艘空闲船，机型因此轮换，不会总是池子最前面那两种。 */
  const pickIdle = () => {
    const idle = riders.filter((rider) => !rider.live)
    return idle.length ? idle[Math.floor(Math.random() * idle.length)] : undefined
  }
  /** 挑一条没人占的轨道；货船优先走中线。 */
  const pickSlot = (kind: TransitKind) => {
    const used = new Set(laneRiders().map((rider) => rider.slot))
    if (kind === 'hauler' && !used.has(0)) return 0
    const free = TRANSIT_LANE.slots.map((_, index) => index).filter((index) => !used.has(index))
    return free.length ? free[Math.floor(Math.random() * free.length)]! : -1
  }

  /**
   * 在 depth 处放一艘船。深度上与现有船冲突、没有空轨道、或压在玩家身上时都不生成。
   * seed 为真时允许把深度往门的方向挪到刚好排在前车后面（铺初始队列用）。返回放好的船或 undefined。
   */
  const launchInLane = (inbound: number, depth: number, avoid: Point3 | undefined, seed = false) => {
    const rider = pickIdle()
    if (!rider) return undefined
    const slot = pickSlot(rider.kind)
    if (slot < 0) return undefined
    const pose = spawnLanePose(inbound, Math.random, rider.kind, depth, slot)
    const occupied = laneOccupied()
    if (!laneDepthFree(depth, pose.radius, occupied)) {
      if (!seed) return undefined
      // 种子队列：排在现有最近一艘的后面
      const nearest = occupied.reduce((min, other) => Math.min(min, other.depth), Infinity)
      const behind = Number.isFinite(nearest) ? nearest + laneGap(pose.radius, occupied.find((o) => o.depth === nearest)!.radius) : depth
      if (behind > depth || !laneDepthFree(behind, pose.radius, occupied)) return undefined
      pose.z = inbound * -behind
    }
    if (avoid && Math.hypot(pose.x - avoid.x, pose.y - avoid.y, pose.z - avoid.z) < TRANSIT_LANE.avoidRadius) return undefined
    launch(rider, inbound, pose, true)
    return rider
  }

  /** 铺初始队列：从生成点往门的方向，一艘接一艘按各自间距排到门前。 */
  const seedLane = (inbound: number, spawnDepth: number, avoid: Point3 | undefined) => {
    let depth = spawnDepth
    for (let guard = 0; guard < TRANSIT_LANE.cap - 1 && depth > TRANSIT_LANE.seedMinDepth; guard += 1) {
      const rider = launchInLane(inbound, depth, avoid, false)
      if (!rider) break
      // 下一艘放在这艘前面（离门更近），间距按"这艘 + 航道里可能出现的最大船"留足，放下去一定不冲突。
      depth = Math.abs(rider.z) - laneGap(rider.radius, LANE_MAX_RADIUS) - Math.random() * 0.4
    }
  }

  return {
    /**
     * lane 非空即进入航道模式：船更慢、更大、更多，各走一条平行轨道，前后按碰撞半径保持间距排队进门；
     * lane.depth 为生成点离门的深度（门局部单位），lane.avoid 为玩家在门局部坐标里的位置，新船不会生成在玩家身上。
     */
    tick(delta: number, active: boolean, reducedMotion: boolean, lane?: { depth: number; avoid?: Point3 }) {
      if (reducedMotion) {
        riders.forEach(hide)
        return
      }

      const inbound = inboundFromCamera(portal, camera, scratch)
      if (lane) {
        if (!laneSeeded) {
          laneSeeded = true
          riders.forEach(hide)
          seedLane(inbound, lane.depth, lane.avoid)
          spawnWait = TRANSIT_LANE.spawnGap[0]
        }
        spawnWait -= delta
        if (spawnWait <= 0 && liveCount() < TRANSIT_LANE.cap) {
          const [minGap, maxGap] = TRANSIT_LANE.spawnGap
          spawnWait = launchInLane(inbound, lane.depth, lane.avoid) ? minGap + Math.random() * (maxGap - minGap) : 0.4
        }
      } else {
        laneSeeded = false
        const cap = active ? PORTAL_TRANSIT_MAX : PORTAL_TRANSIT_IDLE
        spawnWait -= delta
        if (spawnWait <= 0 && liveCount() < cap) {
          const idle = pickIdle()
          if (idle) {
            launch(idle, inbound)
            spawnWait = active ? 0.55 + Math.random() * 0.45 : 1.6 + Math.random() * 1.2
          }
        }
      }

      // 先推进位置，再做跟车修正，最后处理进门/爆炸与绘制。
      for (const rider of riders) {
        if (rider.live && !rider.dissolving) rider.z += rider.inbound * rider.speed * delta
      }
      if (lane) {
        // 跟车：后车不得越过前车的安全间距。轨道平行 + 深度不重叠 = 轨迹永不相交。
        const convoy = laneRiders()
        const depths = enforceLaneFollowing(convoy.map((rider) => ({ depth: Math.abs(rider.z), radius: rider.radius })))
        convoy.forEach((rider, index) => {
          rider.z = rider.inbound * -depths[index]!
        })
      }

      for (const rider of riders) {
        if (!rider.live) continue
        rider.age += delta
        if (!rider.dissolving) {
          if (rider.z * rider.inbound >= 0) {
            rider.z = 0
            rider.dissolving = true
            rider.dissolve = 0
            burstSparks(rider)
          }
        }
        if (rider.dissolving) {
          rider.dissolve += delta * (rider.exploding ? 0.9 : 1.05)
          const count = rider.sparkPos.count
          for (let i = 0; i < count; i += 1) {
            const px = rider.sparkPos.getX(i) + rider.sparkVel[i * 3]! * delta
            const py = rider.sparkPos.getY(i) + rider.sparkVel[i * 3 + 1]! * delta
            const pz = rider.sparkPos.getZ(i) + rider.sparkVel[i * 3 + 2]! * delta
            rider.sparkPos.setXYZ(i, px, py, pz)
            rider.sparkVel[i * 3]! *= 0.94
            rider.sparkVel[i * 3 + 1]! *= 0.94
            rider.sparkVel[i * 3 + 2]! *= 0.9
          }
          rider.sparkPos.needsUpdate = true
          if (rider.dissolve >= 1) {
            hide(rider)
            continue
          }
        }
        paintRider(rider)
      }
    },
    /** 航道里可被撞上的船（门局部坐标），供场景做碰撞判定。返回的数组会被下一次调用复用。 */
    colliders(): readonly TransitCollider[] {
      colliders.length = 0
      riders.forEach((rider, index) => {
        if (!rider.live || rider.dissolving) return
        colliders.push({ index, x: rider.x, y: rider.y, z: rider.z, radius: KIND_RADIUS[rider.kind] * rider.scale })
      })
      return colliders
    },
    /** 把某艘船原地炸掉（被玩家撞上）。 */
    explode(index: number) {
      const rider = riders[index]
      if (!rider || !rider.live || rider.dissolving) return
      rider.dissolving = true
      rider.exploding = true
      rider.dissolve = 0
      burstSparks(rider)
    },
    paint(hull: THREE.Color, trim: THREE.Color, glow: THREE.Color) {
      for (const rider of riders) {
        if ('color' in rider.hull) (rider.hull as THREE.MeshStandardMaterial).color.copy(hull)
        if ('color' in rider.trim) (rider.trim as THREE.MeshStandardMaterial).color.copy(trim)
        if ('color' in rider.glow) (rider.glow as THREE.MeshBasicMaterial).color.copy(glow)
        rider.ribbonMat.color.copy(glow)
        rider.coreMat.color.copy(trim)
        rider.flashMat.color.copy(trim)
        rider.haloMat.color.copy(glow)
        rider.ringMat.color.copy(glow)
        rider.sparkMat.color.copy(trim)
      }
    },
    dispose() {
      for (const rider of riders) {
        portal.remove(rider.craft, rider.ribbonA, rider.ribbonB, rider.core, rider.sparks, rider.ring, rider.flash, rider.halo)
        const dropped = new Set<THREE.Material>()
        rider.craft.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return
          child.geometry.dispose()
          const materials = Array.isArray(child.material) ? child.material : [child.material]
          for (const material of materials) {
            if (dropped.has(material)) continue
            dropped.add(material)
            material.dispose()
          }
        })
        rider.ribbonA.geometry.dispose()
        rider.ribbonB.geometry.dispose()
        rider.ribbonMat.dispose()
        rider.core.geometry.dispose()
        rider.coreMat.dispose()
        rider.sparks.geometry.dispose()
        rider.sparkMat.dispose()
        rider.ring.geometry.dispose()
        rider.ringMat.dispose()
        rider.flashMat.dispose()
        rider.haloMat.dispose()
      }
      ribbonTex.dispose()
    },
  }
}
