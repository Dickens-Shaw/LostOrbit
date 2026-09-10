import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildFactoryVoxels, CUBE_SIZE, CUBE_SPACING, FACTORY_BASE_DISTANCE, planFactoryFrame } from '../layout/absentFactoryLayout'
import { buildFighter, FIGHTER_EXHAUSTS, FIGHTER_WINGTIP } from '../craft/craftModels'
import { DEPARTING_BODY_CLASS } from '../runners/gridRunnerField'
import {
  assistHeading,
  buildDepartureWaypoints,
  flightEase,
  headingFromDirection,
  headingVector,
  PILOT,
  planCruiseStage,
  samplePortalDeparture,
  sampleScanRetraction,
  scanFanBase,
  SCAN_IMPACT_Z,
  steerFromPointer,
  stepBarrel,
  stepPilot,
  type AlignTurnPath,
  type CruiseStagePlan,
  type DepartureWaypointMarks,
  type PilotState,
  type Point3,
} from '../flight/portalDeparture'
import { mountPortalTuner, shouldMountPortalTuner, type PortalTunerHandle } from '../tuner/portalTuner'
import { TRANSIT_LANE, createPortalTransit, findTransitCollision } from '../transit/portalTransit'
import {
  createExhaustPlume,
  createShipExplosion,
  createWingTrail,
  plumeProfileForSpeed,
  trailProfileForSpeed,
} from '../effects/shipEffects'

const SCAN_SPEED = 1.5
const SCAN_AMPLITUDE = 3.5
const SCAN_BAND = 0.65
const SCAN_POP = 1.35
const SCAN_LERP = 0.14
const FACTORY_SPEED = 1.2
const STAGE_SCALE = 0.95
const LASER_HALF = 7.8
/** 扫描落地横条整体透明度倍率，细芯和宽晕共用。 */
export const LASER_IMPACT_OPACITY = 0.6
const CAMERA_DISTANCE = FACTORY_BASE_DISTANCE
/** 飞船默认停在右上角，坐标是舞台局部系。 */
const SHIP_HOME = { x: 5.8, y: 5.2, z: 2.55 }
const SHIP_RANGE = { x: 10, minY: -1.5, maxY: 8 }
/** 中间数字 0 的几何中心，航路会沿这里的 z 轴安全穿过。 */
const ZERO_PASS_POINT: Point3 = { x: -CUBE_SPACING / 2, y: 0, z: 0 }
/** 追尾镜头两套弹簧臂：穿 0 时收短以便跟着钻洞，出洞后放长成飞行游戏视角。 */
const CHASE_ARM_TUNNEL = { behind: 1.9, above: 0.38, side: 0, ahead: 3 }
const CHASE_ARM_CRUISE = { behind: 4.8, above: 1.3, side: 0, ahead: 2.8 }
/** 游戏模式的弹簧臂：和巡航同一正后方视角，只是拉远一些，尾焰和尾迹有足够画面空间。 */
const CHASE_ARM_PILOT = { behind: 7.2, above: 2, side: 0, ahead: 2.8 }
const COCKPIT_ARM = { behind: -0.3, above: 0.24, side: 0, ahead: 4.5 }
/** 第三人称滚轮缩放：弹簧臂整体乘以该倍率，指数步进让手感线性。 */
const CHASE_ZOOM = { min: 0.5, max: 2.6, rate: 0.0012 }
/** 穿 0 时尾焰的长度上限，必须小于短臂的 behind，否则尾焰会穿过镜头。 */
const TUNNEL_PLUME_LENGTH = 1.5
/** 起飞后镜头的远裁剪面下限：传送门离出洞点约 156 单位，软边界 180，再留镜头臂和放大余量。 */
const DEPARTURE_FAR = 400
/** 机头转向目标航向的速率。对准段跟解析切线，不再用慢 slerp 去追抖动的样条切线。 */
const HEADING_TURN = { takeoff: 12, flight: 18, align: 26 } as const
/** 过场机头看向航路上前方这一点（舞台单位），把样条结点处的切线毛刺抹平。 */
const HEADING_LOOKAHEAD = 2.6
/** 撞机：机身碰撞半径（舞台单位）、爆炸后多久回到巡航起点、重生后的无敌与淡入时长。 */
const CRASH = { shipRadius: 0.5, respawnDelay: 1.9, grace: 1.6, fadeIn: 0.45 } as const
/** 出洞后重新布景时传送门的缩放：放大到 120 多单位外也能看清的尺度（门环半径约 9.2）。 */
const RESTAGED_STATION_SCALE = 7.8
/** 滚转跟随偏航角速度：最大滚转角与增益。 */
const BANK_ROLL = 0.55
const BANK_GAIN = 0.32
/** 飞船面朝 +z，相机面朝 -z，第一人称要绕 y 转半圈。 */
const FLIP_Y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
const dragNormal = new THREE.Vector3(0, 0, 1)
/** 空间门默认朝 404 一侧侧倾，悬停后转回接近正对相机。 */
/** 图 2：先绕 Y 压成窄椭圆，再绕 Z 逆时针让长轴走左上→右下。 */
const PORTAL_TILT = { x: -0.512, y: 1.028, z: 0.72, hoverX: -0.06, hoverY: 0.88, hoverZ: 0.28 }

type VoxelRuntime = {
  mesh: THREE.Mesh
  material: THREE.MeshStandardMaterial
  layer: 0 | 1
  baseColor: THREE.Color
  base: THREE.Vector3
  zOffset: number
}

type ThemePalette = {
  face: THREE.Color
  side: THREE.Color
  laser: THREE.Color
  laserCore: THREE.Color
  lit: THREE.Color
  rim: THREE.Color
  accent: THREE.Color
  accentInk: THREE.Color
  structure: THREE.Color
}

/** 扫描光幕里镭射线的默认数量，可通过 options.rayCount 覆盖。 */
export const SCAN_RAY_COUNT = 7

export type AbsentFactoryOptions = {
  reducedMotion: boolean
  stationLabel: string
  onStation?: () => void
  rayCount?: number
}

function canUseWebGL(): boolean {
  const probe = document.createElement('canvas')
  return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'))
}

function cssColor(name: string, fallback: string): THREE.Color {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return new THREE.Color(value || fallback)
}

function hexOf(color: THREE.Color): string {
  return `#${color.getHexString()}`
}

function readThemePalette(): ThemePalette {
  const accent = cssColor('--lp-accent', '#c8a96b')
  const accentInk = cssColor('--lp-accent-ink', '#0a0a09')
  const sheen = cssColor('--lp-sheen', '#e8e6df')
  const canvas = cssColor('--lp-canvas', '#0a0a09')
  const ink = cssColor('--lp-ink', '#e8e6df')
  return {
    face: accent.clone(),
    side: accent.clone().lerp(canvas, 0.28),
    laser: accent.clone(),
    laserCore: accent.clone().lerp(sheen, 0.22),
    lit: accent.clone().lerp(sheen, 0.2),
    rim: accent.clone(),
    accent,
    accentInk,
    structure: canvas.clone().lerp(ink, 0.38),
  }
}

function createLaserTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)

  const across = ctx.createLinearGradient(0, 0, 256, 0)
  across.addColorStop(0, 'rgba(255,255,255,0)')
  across.addColorStop(0.18, 'rgba(255,255,255,0.55)')
  across.addColorStop(0.5, 'rgba(255,255,255,1)')
  across.addColorStop(0.82, 'rgba(255,255,255,0.55)')
  across.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = across
  ctx.fillRect(0, 0, 256, 32)

  const along = ctx.createLinearGradient(0, 0, 0, 32)
  along.addColorStop(0, 'rgba(0,0,0,0.85)')
  along.addColorStop(0.5, 'rgba(0,0,0,0)')
  along.addColorStop(1, 'rgba(0,0,0,0.85)')
  ctx.fillStyle = along
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillRect(0, 0, 256, 32)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function createScoutCraft(
  hull: THREE.MeshStandardMaterial,
  trim: THREE.MeshStandardMaterial,
  glow: THREE.MeshBasicMaterial,
): { craft: THREE.Group; emitter: THREE.Mesh } {
  // 机身沿 +z 排布：lookAt 会把 +z 对准目标，所以机头和发光点永远朝着 404。
  const craft = new THREE.Group()
  const { emitter } = buildFighter(craft, { hull, trim, glow })
  return { craft, emitter }
}

function createHoloTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)

  ctx.fillStyle = '#404040'
  ctx.fillRect(0, 0, 256, 256)
  ctx.globalCompositeOperation = 'lighter'
  let seed = 7
  const next = () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
  for (let i = 0; i < 90; i += 1) {
    const x = next() * 256
    const y = next() * 256
    const radius = 18 + next() * 54
    const blob = ctx.createRadialGradient(x, y, 0, x, y, radius)
    blob.addColorStop(0, `rgba(255,255,255,${0.14 + next() * 0.2})`)
    blob.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = blob
    for (const dx of [-256, 0, 256]) {
      for (const dy of [-256, 0, 256]) {
        ctx.save()
        ctx.translate(dx, dy)
        ctx.fillRect(0, 0, 256, 256)
        ctx.restore()
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.needsUpdate = true
  return texture
}

const HOLO_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const HOLO_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uCore;
  uniform float uTime;
  uniform float uOpacity;
  uniform sampler2D uNoise;
  #if RAY_COUNT > 0
  uniform float uRayBase[RAY_COUNT];
  uniform float uRayBright[RAY_COUNT];
  #endif
  varying vec2 vUv;

  float edgeDistance(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    vec2 ap = p - a;
    return abs(ab.x * ap.y - ab.y * ap.x) / length(ab);
  }

  void main() {
    vec2 apex = vec2(0.5, 1.0);
    float height = clamp(vUv.y, 0.0, 1.0);
    float density = mix(0.08, 1.0, pow(height, 1.7));

    float flow = texture2D(uNoise, vec2(vUv.x * 1.8 + uTime * 0.02, vUv.y * 1.4 - uTime * 0.09)).r;
    float flow2 = texture2D(uNoise, vec2(vUv.x * 3.1 - uTime * 0.035, vUv.y * 2.2 - uTime * 0.16)).r;
    float grain = 0.45 + flow * 0.7 + flow2 * 0.35;

    float left = edgeDistance(vUv, apex, vec2(0.0, 0.0));
    float right = edgeDistance(vUv, apex, vec2(1.0, 0.0));
    float rim = 1.0 - smoothstep(0.0, 0.05, min(left, right));
    float base = 1.0 - smoothstep(0.0, 0.03, vUv.y);

    // 从顶点射向底边的若干条镭射线：底边落点左右游走，亮度由 CPU 随机驱动，越靠顶点越细越亮。
    float rays = 0.0;
    #if RAY_COUNT > 0
    for (int i = 0; i < RAY_COUNT; i++) {
      float rayX = mix(uRayBase[i], 0.5, height);
      float width = mix(0.011, 0.0025, height);
      float d = abs(vUv.x - rayX);
      float core = exp(-d * d / (width * width));
      float halo = exp(-d * d / (width * width * 14.0)) * 0.3;
      rays += (core + halo) * uRayBright[i];
    }
    #endif
    rays *= 0.35 + height * 0.65;

    float alpha = density * grain * 0.55 + rim * 0.42 * (0.4 + height * 0.6) + base * 0.35 + rays * 0.85;
    vec3 color = mix(uColor, uCore, clamp(rim * 0.6 + pow(height, 3.0) * 0.5 + rays * 0.5, 0.0, 1.0));
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0) * uOpacity);
  }
`

type ScanRay = { center: number; amp: number; speed: number; phase: number; bright: number; target: number }

function createScanRays(count: number): ScanRay[] {
  return Array.from({ length: count }, (_, index) => ({
    center: 0.5 + ((index + 0.5) / count - 0.5) * 0.9,
    amp: 0.05 + Math.random() * 0.12,
    speed: 0.5 + Math.random() * 1.1,
    phase: Math.random() * Math.PI * 2,
    bright: 0.3 + Math.random() * 0.5,
    target: 0.3 + Math.random() * 0.7,
  }))
}

function createLaserLayer(
  width: number,
  height: number,
  opacity: number,
  texture: THREE.CanvasTexture,
): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; geometry: THREE.PlaneGeometry } {
  const geometry = new THREE.PlaneGeometry(width, height)
  const material = new THREE.MeshBasicMaterial({
    color: 0xc8a96b,
    map: texture,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.z = 1.25
  return { mesh, material, geometry }
}

function createPortalTexture(core: string, rim: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)

  const glow = ctx.createRadialGradient(256, 256, 8, 256, 256, 250)
  glow.addColorStop(0, core)
  glow.addColorStop(0.28, rim)
  glow.addColorStop(0.62, 'rgba(200, 169, 107, 0.28)')
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 512, 512)

  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = rim
  for (let i = 0; i < 6; i += 1) {
    ctx.lineWidth = i === 0 ? 7 : 3
    ctx.globalAlpha = 0.55 - i * 0.06
    ctx.beginPath()
    ctx.arc(256, 256, 48 + i * 32, 0, Math.PI * 2)
    ctx.stroke()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function createPortalRingTexture(streaks: number, seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)

  const ring = ctx.createRadialGradient(256, 256, 150, 256, 256, 250)
  ring.addColorStop(0, 'rgba(255,255,255,0)')
  ring.addColorStop(0.55, 'rgba(255,255,255,0.18)')
  ring.addColorStop(0.72, 'rgba(255,255,255,0.95)')
  ring.addColorStop(0.82, 'rgba(255,255,255,0.35)')
  ring.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = ring
  ctx.fillRect(0, 0, 512, 512)

  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineCap = 'round'
  let random = seed
  const next = () => {
    random = (random * 9301 + 49297) % 233280
    return random / 233280
  }
  for (let i = 0; i < streaks; i += 1) {
    const angle = next() * Math.PI * 2
    const span = 0.08 + next() * 0.45
    const radius = 176 + next() * 60
    ctx.lineWidth = 1 + next() * 2.4
    ctx.globalAlpha = 0.25 + next() * 0.55
    ctx.beginPath()
    ctx.arc(256, 256, radius, angle, angle + span)
    ctx.stroke()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function createGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)
  const glow = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  glow.addColorStop(0, 'rgba(255,255,255,1)')
  glow.addColorStop(0.3, 'rgba(255,255,255,0.55)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

/** 单色站牌：主题色底 + 反色文字。 */
function createStationSignTexture(label: string, ink: string, plate: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 160
  const ctx = canvas.getContext('2d')
  if (!ctx) return new THREE.CanvasTexture(canvas)

  ctx.fillStyle = plate
  ctx.fillRect(0, 0, 1024, 160)
  ctx.fillStyle = ink
  ctx.font = '600 64px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label.toUpperCase(), 512, 84)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

/** 只画四个角尖的可交互提示框，科幻 UI 常见的目标框。 */
function createCornerBrackets(halfWidth: number, halfHeight: number, arm: number, material: THREE.LineBasicMaterial) {
  const points: number[] = []
  const corners: Array<[number, number]> = [
    [-halfWidth, halfHeight],
    [halfWidth, halfHeight],
    [halfWidth, -halfHeight],
    [-halfWidth, -halfHeight],
  ]
  for (const [x, y] of corners) {
    const dx = x > 0 ? -arm : arm
    const dy = y > 0 ? -arm : arm
    points.push(x, y, 0, x + dx, y, 0)
    points.push(x, y, 0, x, y + dy, 0)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  return new THREE.LineSegments(geometry, material)
}

/** 从空间门牵到便签的折线；按长度细分成等距顶点，用 drawRange 做「从门那头画出来」的动画。 */
function createLeaderLine(points: THREE.Vector3[], material: THREE.LineBasicMaterial, segments = 64) {
  let length = 0
  for (let i = 1; i < points.length; i += 1) length += points[i]!.distanceTo(points[i - 1]!)
  const dense: THREE.Vector3[] = [points[0]!.clone()]
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1]!
    const to = points[i]!
    const steps = Math.max(1, Math.round((from.distanceTo(to) / length) * segments))
    for (let s = 1; s <= steps; s += 1) dense.push(from.clone().lerp(to, s / steps))
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(dense)
  geometry.setDrawRange(0, 0)
  const line = new THREE.Line(geometry, material)
  const setProgress = (progress: number) => {
    geometry.setDrawRange(0, Math.round(THREE.MathUtils.clamp(progress, 0, 1) * dense.length))
  }
  return { line, geometry, setProgress }
}

function markStation(mesh: THREE.Object3D) {
  mesh.userData.station = true
  mesh.traverse((child) => {
    child.userData.station = true
  })
}

export function mountAbsentFactory(
  host: HTMLElement,
  { reducedMotion, stationLabel, onStation, rayCount = SCAN_RAY_COUNT }: AbsentFactoryOptions,
): () => void {
  if (!canUseWebGL()) return () => {}

  const scene = new THREE.Scene()

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400)
  camera.position.set(0, 0.3, CAMERA_DISTANCE)
  camera.lookAt(0, 0, 0)

  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
  } catch {
    return () => {}
  }

  renderer.setClearColor(0x000000, 0)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.28
  renderer.domElement.dataset.testid = 'absent-factory-canvas'
  renderer.domElement.style.cursor = 'grab'
  const cameraHint = document.createElement('div')
  cameraHint.className = 'absent-camera-hint'
  cameraHint.textContent = 'V · 切换第一人称'
  cameraHint.setAttribute('aria-hidden', 'true')
  /** 玩家驾驶阶段的速度表：一条细条，宽度就是当前速度 / 最高速度。 */
  const speedGauge = document.createElement('div')
  speedGauge.className = 'absent-speed-gauge'
  speedGauge.setAttribute('aria-hidden', 'true')
  const speedFill = document.createElement('i')
  speedGauge.append(speedFill)
  /** 传送门出画时贴在画面边缘的指向箭头，免得玩家转弯后丢了目标。 */
  const portalMarker = document.createElement('div')
  portalMarker.className = 'absent-portal-marker'
  portalMarker.setAttribute('aria-hidden', 'true')
  portalMarker.textContent = '▲'
  host.replaceChildren(renderer.domElement, speedGauge, portalMarker, cameraHint)

  const cameraHintText = () =>
    pilotActive
      ? `鼠标 转向 · W/S 油门 · Shift 加力 · A/D 滚转 · Q/E 翻滚 · Alt 观察 · V ${firstPerson ? '第三人称' : '第一人称'}${firstPerson ? '' : ' · 滚轮 远近'}`
      : firstPerson
        ? 'V · 切换第三人称'
        : 'V · 切换第一人称 · 滚轮 远近'

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.enablePan = false
  controls.enableZoom = true
  controls.enableRotate = true
  controls.minDistance = 10
  controls.maxDistance = 220
  controls.target.set(0, 0, 0)
  controls.update()

  const pointer = new THREE.Vector2()
  const raycaster = new THREE.Raycaster()
  let hoveringStation = false
  let pressedStation = false
  let hoveringShip = false
  let draggingShip = false
  let departureActive = false
  let departureFinished = false
  let departureElapsed = 0
  let firstPerson = false
  /** 出洞之后：镜头交给追尾臂、V 可切视角、传送门已重新布景。 */
  let restaged = false
  /** 镜头是否已脱离轨道机位开始跟飞船（S4 弧线中段起）。 */
  let cameraFollowing = false
  let voxelFade = 1
  let lastScanY = 0
  let cruisePlan: CruiseStagePlan | null = null
  /** 穿 0 前的起飞样条；出洞后改走解析对准曲线，避免 Catmull-Rom 在接手点左右摆。 */
  let flightCurve: THREE.CatmullRomCurve3 | null = null
  let flightAlign: AlignTurnPath | null = null
  let flightApproachLen = 1
  let flightTotalLen = 1
  let flightMarks: Record<keyof DepartureWaypointMarks, number> | null = null
  let prevYaw = 0
  let yawRateSmoothed = 0
  let bankRoll = 0
  /** 玩家驾驶：过场飞到左转正对传送门后接管。 */
  let pilotActive = false
  let pilot: PilotState = { speed: 0, yaw: 0, pitch: 0 }
  /** 入门动画计时；小于 0 表示还没进门。 */
  let enterElapsed = -1
  let enterSpeed = 0
  /** 撞机计时；小于 0 表示没撞。撞后机身隐藏、爆炸播放，到 CRASH.respawnDelay 回巡航起点重来。 */
  let crashElapsed = -1
  /** 重生后的无敌时间倒计时，顺带做画面淡入。 */
  let respawnGrace = 0
  /** 下一帧追尾镜头直接跳到目标机位（重生用），不做阻尼过渡。 */
  let cameraSnap = false
  /** 进港航道的生成点离门心的深度（门局部单位），重新布景时按航程算出。 */
  let laneSpawnDepth = 6
  const heldKeys = new Set<string>()
  /** 鼠标转向的当前舵位；active 为 false 表示指针不在窗口内或还没动过，视为回中。 */
  const pilotPointer = { nx: 0, ny: 0, active: false }
  /** 接管后鼠标舵量在 0.8s 内渐入：点门时指针多半不在画面中心，避免一接手就猛转。 */
  let steerGain = 0
  /** A/D 手动滚转量，叠加在转弯自动压坡度之上。 */
  let manualRoll = 0
  /** Q/E 连续翻滚角，松开后回正。 */
  let barrelRoll = 0
  /** Alt + 鼠标观察：相对追尾机位的偏航 / 俯仰，松手回正。 */
  let lookYaw = 0
  let lookPitch = 0
  const lookEuler = new THREE.Euler(0, 0, 0, 'YXZ')
  const lookQuat = new THREE.Quaternion()
  /** 按位移实测的机速（舞台单位 / 秒），尾焰与尾迹都跟它走，过场与驾驶阶段共用。 */
  let measuredSpeed = 0
  const prevShipPos = new THREE.Vector3()
  const sweptPath = new THREE.Line3()
  const dragPlane = new THREE.Plane()
  const dragPoint = new THREE.Vector3()
  const worldTmp = new THREE.Vector3()
  const cameraLocalTmp = new THREE.Vector3()
  const aheadTmp = new THREE.Vector3()
  const tangentTmp = new THREE.Vector3()
  const orbitCameraPos = new THREE.Vector3()
  const orbitTarget = new THREE.Vector3()
  const desiredCamera = new THREE.Vector3()
  const desiredLook = new THREE.Vector3()
  const desiredQuat = new THREE.Quaternion()
  /** 机身平滑后的航向（不含滚转）与本帧的目标朝向。 */
  const shipHeading = new THREE.Quaternion()
  const headingTarget = new THREE.Quaternion()
  const headingEuler = new THREE.Euler(0, 0, 0, 'YXZ')
  const forwardTmp = new THREE.Vector3()
  const lookAheadTmp = new THREE.Vector3()
  const chaseArm = { ...CHASE_ARM_TUNNEL }
  let chaseZoom = 1

  const setPointer = (event: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  }

  const stationHits = () => {
    raycaster.setFromCamera(pointer, camera)
    const targets = [hitDisc, sign].filter((object) => object.visible)
    return raycaster.intersectObjects(targets, false).length > 0
  }

  const shipHits = () => {
    raycaster.setFromCamera(pointer, camera)
    return raycaster.intersectObject(scout, true).length > 0
  }

  const refreshCursor = () => {
    if (draggingShip) renderer.domElement.style.cursor = 'grabbing'
    else if (hoveringStation) renderer.domElement.style.cursor = 'pointer'
    else if (hoveringShip) renderer.domElement.style.cursor = 'move'
    else renderer.domElement.style.cursor = 'grab'
  }

  scene.add(new THREE.AmbientLight(0xffffff, 1.15))

  const mainLight = new THREE.DirectionalLight(0xfff6e4, 1.7)
  mainLight.position.set(10, 16, 14)
  mainLight.castShadow = true
  mainLight.shadow.mapSize.set(1024, 1024)
  scene.add(mainLight)

  const rimLight = new THREE.DirectionalLight(0xc8a96b, 1.35)
  rimLight.position.set(-14, -8, -8)
  scene.add(rimLight)

  const cubeGeo = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE)
  const faceMaterial = new THREE.MeshStandardMaterial({
    color: 0xc8a96b,
    metalness: 0.38,
    roughness: 0.46,
  })
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: 0xc8a96b,
    metalness: 0.32,
    roughness: 0.52,
  })

  const stage = new THREE.Group()
  stage.position.set(0, -1.35, 0)
  stage.scale.setScalar(STAGE_SCALE)
  scene.add(stage)

  const voxels: VoxelRuntime[] = buildFactoryVoxels().map((spec) => {
    const material = (spec.layer === 0 ? faceMaterial : sideMaterial).clone()
    const mesh = new THREE.Mesh(cubeGeo, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.position.set(spec.x, spec.y, spec.z)
    stage.add(mesh)
    return {
      mesh,
      material,
      layer: spec.layer,
      baseColor: material.color.clone(),
      base: new THREE.Vector3(spec.x, spec.y, spec.z),
      zOffset: 0,
    }
  })

  const laserTexture = createLaserTexture()
  const impact = createLaserLayer(LASER_HALF * 2, 0.06, reducedMotion ? 0 : LASER_IMPACT_OPACITY, laserTexture)
  const impactHalo = createLaserLayer(LASER_HALF * 2, 0.42, reducedMotion ? 0 : 0.32 * LASER_IMPACT_OPACITY, laserTexture)
  impact.mesh.position.set(0, 0, 1.25)
  impactHalo.mesh.position.set(0, 0, 1.22)
  stage.add(impact.mesh, impactHalo.mesh)

  const glowTexture = createGlowTexture()
  const emitterMat = new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xc8a96b,
    transparent: true,
    opacity: reducedMotion ? 0 : 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const emitter = new THREE.Sprite(emitterMat)
  emitter.scale.setScalar(0.9)
  stage.add(emitter)

  const engineGlowMat = new THREE.MeshBasicMaterial({
    color: 0xc8a96b,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const scoutHull = new THREE.MeshStandardMaterial({
    color: 0x2a2a28,
    metalness: 0.58,
    roughness: 0.4,
  })
  const scoutTrim = new THREE.MeshStandardMaterial({
    color: 0xc8a96b,
    metalness: 0.42,
    roughness: 0.36,
  })
  const { craft: scout, emitter: scoutEmitter } = createScoutCraft(scoutHull, scoutTrim, engineGlowMat)
  scout.position.set(SHIP_HOME.x, SHIP_HOME.y, SHIP_HOME.z)
  const shipHitGeo = new THREE.SphereGeometry(0.62, 12, 8)
  const shipHitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  scout.add(new THREE.Mesh(shipHitGeo, shipHitMat))
  stage.add(scout)

  // 三台发动机各一束尾焰，挂在机身上随速度伸缩。
  const exhaustPlumes = FIGHTER_EXHAUSTS.map((engine) => {
    const plume = createExhaustPlume(engine, glowTexture)
    scout.add(plume.group)
    return plume
  })

  // 两道翼尖尾迹，历史点记在舞台局部坐标里，所以转弯后尾迹会留在原地。
  const wingTrails = [-FIGHTER_WINGTIP.x, FIGHTER_WINGTIP.x].map((wingX) => {
    const trail = createWingTrail(160)
    stage.add(trail.group)
    return { wingX, trail }
  })

  // 撞上航道里的船时的爆炸，挂在舞台上；碎片沿用机身材质。
  const explosion = createShipExplosion(glowTexture, scoutHull)
  stage.add(explosion.group)

  const bracketMat = new THREE.LineBasicMaterial({
    color: 0xc8a96b,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const shipBracketMat = bracketMat.clone()
  const shipBracket = createCornerBrackets(0.62, 0.5, 0.18, shipBracketMat)
  shipBracket.renderOrder = 4
  stage.add(shipBracket)

  const holoTexture = createHoloTexture()
  const triangleGeo = new THREE.BufferGeometry()
  const trianglePos = new Float32Array(9)
  triangleGeo.setAttribute('position', new THREE.BufferAttribute(trianglePos, 3))
  triangleGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0.5, 1, 0, 0, 1, 0]), 2))
  const rays = createScanRays(Math.max(0, Math.floor(rayCount)))
  const rayBase = new Float32Array(Math.max(rays.length, 1))
  const rayBright = new Float32Array(Math.max(rays.length, 1))
  const triangleMat = new THREE.ShaderMaterial({
    vertexShader: HOLO_VERTEX,
    fragmentShader: HOLO_FRAGMENT,
    defines: { RAY_COUNT: rays.length },
    uniforms: {
      uColor: { value: new THREE.Color(0xc8a96b) },
      uCore: { value: new THREE.Color(0xefe6cf) },
      uTime: { value: 0 },
      uOpacity: { value: reducedMotion ? 0 : 0.55 },
      uNoise: { value: holoTexture },
      uRayBase: { value: rayBase },
      uRayBright: { value: rayBright },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  const triangle = new THREE.Mesh(triangleGeo, triangleMat)
  triangle.renderOrder = 2
  triangle.frustumCulled = false
  stage.add(triangle)

  const scanCorePos = new Float32Array(6)
  const scanCoreGeo = new THREE.BufferGeometry()
  scanCoreGeo.setAttribute('position', new THREE.BufferAttribute(scanCorePos, 3))
  const scanCoreMat = new THREE.LineBasicMaterial({
    color: 0xefe6cf,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const scanCore = new THREE.Line(scanCoreGeo, scanCoreMat)
  scanCore.renderOrder = 3
  scanCore.visible = false
  stage.add(scanCore)

  let portalTexture = createPortalTexture('#efe6cf', '#c8a96b')
  const veilMat = new THREE.MeshBasicMaterial({
    map: portalTexture,
    color: 0xc8a96b,
    transparent: true,
    opacity: reducedMotion ? 0.55 : 0.7,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  })

  const station = new THREE.Group()
  station.position.set(-9.6, 3.45, -0.4)
  station.scale.setScalar(0.72)
  scene.add(station)

  // 门体单独一组：默认带侧倾露出厚度，悬停时转回来正对观众；站牌、折线、角框留在 station 里保持正立。
  const portal = new THREE.Group()
  portal.rotation.order = 'YXZ'
  portal.rotation.set(PORTAL_TILT.x, PORTAL_TILT.y, PORTAL_TILT.z)
  station.add(portal)
  let hoverAmount = 0

  const ringTextures = [createPortalRingTexture(22, 11), createPortalRingTexture(34, 47), createPortalRingTexture(16, 83)]
  const ringGeo = new THREE.PlaneGeometry(3.4, 3.4)
  // 外面两层光圈用多片切片 + 一圈发光管撑出厚度，侧视时不再是一张纸。
  const ringSpecs = [
    { scale: 1, speed: 0.32, opacity: 0.85, slices: 5, depth: 0.42 },
    { scale: 0.82, speed: -0.5, opacity: 0.7, slices: 1, depth: 0 },
    { scale: 1.16, speed: 0.18, opacity: 0.45, slices: 5, depth: 0.56 },
  ]
  const ringTubeGeos: THREE.TorusGeometry[] = []
  const rings = ringSpecs.map((spec, index) => {
    const sliceOpacity = spec.opacity / (spec.slices > 1 ? spec.slices * 0.55 : 1)
    const material = new THREE.MeshBasicMaterial({
      map: ringTextures[index]!,
      color: 0xc8a96b,
      transparent: true,
      opacity: sliceOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    const group = new THREE.Group()
    group.scale.setScalar(spec.scale)
    group.position.z = index * 0.04
    for (let i = 0; i < spec.slices; i += 1) {
      const slice = new THREE.Mesh(ringGeo, material)
      slice.position.z = spec.slices > 1 ? (i / (spec.slices - 1) - 0.5) * spec.depth : 0
      group.add(slice)
    }
    let tube: THREE.Mesh | undefined
    if (spec.slices > 1) {
      const tubeGeo = new THREE.TorusGeometry(1.31, spec.depth * 0.5, 10, 72)
      ringTubeGeos.push(tubeGeo)
      const tubeMat = new THREE.MeshBasicMaterial({
        color: 0xc8a96b,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
      tube = new THREE.Mesh(tubeGeo, tubeMat)
      group.add(tube)
    }
    markStation(group)
    portal.add(group)
    return { group, material, tube, speed: spec.speed, baseOpacity: sliceOpacity, angle: 0 }
  })

  const veilGeo = new THREE.CircleGeometry(1.15, 48)
  const veil = new THREE.Mesh(veilGeo, veilMat)
  markStation(veil)
  portal.add(veil)

  const sparkCount = 96
  const sparkPositions = new Float32Array(sparkCount * 3)
  for (let i = 0; i < sparkCount; i += 1) {
    const angle = Math.random() * Math.PI * 2
    const radius = 1.05 + Math.random() * 0.75
    sparkPositions[i * 3] = Math.cos(angle) * radius
    sparkPositions[i * 3 + 1] = Math.sin(angle) * radius
    sparkPositions[i * 3 + 2] = (Math.random() - 0.5) * 0.5
  }
  const sparkGeo = new THREE.BufferGeometry()
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3))
  const sparkMat = new THREE.PointsMaterial({
    color: 0xc8a96b,
    map: glowTexture,
    size: 0.11,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const sparks = new THREE.Points(sparkGeo, sparkMat)
  portal.add(sparks)

  const hitGeo = new THREE.CircleGeometry(1.9, 24)
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  const hitDisc = new THREE.Mesh(hitGeo, hitMat)
  hitDisc.position.z = 0.2
  markStation(hitDisc)
  portal.add(hitDisc)

  const transit = createPortalTransit({
    portal,
    camera,
    glowMap: glowTexture,
    makeMaterials: () => ({
      hull: scoutHull.clone(),
      trim: scoutTrim.clone(),
      glow: engineGlowMat.clone(),
    }),
  })

  const stationBracket = createCornerBrackets(2.15, 2.15, 0.42, bracketMat)
  stationBracket.renderOrder = 4
  station.add(stationBracket)

  const leaderMat = new THREE.LineBasicMaterial({
    color: 0xc8a96b,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const leader = createLeaderLine(
    [new THREE.Vector3(0.95, 0.95, 0.35), new THREE.Vector3(1.85, 1.85, 0.35), new THREE.Vector3(2.45, 1.85, 0.35)],
    leaderMat,
  )
  leader.line.renderOrder = 4
  leader.line.visible = false
  station.add(leader.line)
  let leaderProgress = 0

  const signGeo = new THREE.PlaneGeometry(2.1, 0.34)
  let signTexture = createStationSignTexture(stationLabel, '#0a0a09', '#c8a96b')
  const signMat = new THREE.MeshBasicMaterial({ map: signTexture, toneMapped: false, transparent: true, opacity: 0 })
  const sign = new THREE.Mesh(signGeo, signMat)
  sign.position.set(3.55, 1.85, 0.4)
  sign.visible = false
  markStation(sign)
  station.add(sign)
  let signTarget = 0

  let palette = readThemePalette()

  const paintSign = () => {
    signTexture.dispose()
    signTexture = createStationSignTexture(stationLabel, hexOf(palette.accentInk), hexOf(palette.accent))
    signMat.map = signTexture
    signMat.needsUpdate = true
    portalTexture.dispose()
    portalTexture = createPortalTexture(hexOf(palette.laserCore), hexOf(palette.accent))
    veilMat.map = portalTexture
    veilMat.color.copy(palette.accent)
    veilMat.needsUpdate = true
    rings.forEach((ring, index) => {
      ring.material.color.copy(index === 1 ? palette.laserCore : palette.accent)
      if (ring.tube) (ring.tube.material as THREE.MeshBasicMaterial).color.copy(palette.accent)
    })
    sparkMat.color.copy(palette.laserCore)
    bracketMat.color.copy(palette.laserCore)
    shipBracketMat.color.copy(palette.laserCore)
    leaderMat.color.copy(palette.laserCore)
    scanCoreMat.color.copy(palette.laserCore)
    exhaustPlumes.forEach((plume) => plume.paint(palette.laserCore, palette.laser))
    wingTrails.forEach(({ trail }) => trail.paint(palette.laserCore, palette.laser))
    explosion.paint(palette.laserCore, palette.laser)
  }

  const applyPalette = () => {
    palette = readThemePalette()
    faceMaterial.color.copy(palette.face)
    sideMaterial.color.copy(palette.side)
    impact.material.color.copy(palette.laserCore)
    impactHalo.material.color.copy(palette.laser)
    emitterMat.color.copy(palette.laserCore)
    ;(triangleMat.uniforms.uColor!.value as THREE.Color).copy(palette.laser)
    ;(triangleMat.uniforms.uCore!.value as THREE.Color).copy(palette.laserCore)
    engineGlowMat.color.copy(palette.laser)
    scoutHull.color.copy(palette.structure)
    scoutTrim.color.copy(palette.accent)
    rimLight.color.copy(palette.rim)
    transit.paint(palette.structure, palette.accent, palette.laserCore)
    paintSign()
    for (const voxel of voxels) {
      voxel.baseColor.copy(voxel.layer === 0 ? palette.face : palette.side)
      if (voxel.zOffset <= 0.18) voxel.material.color.copy(voxel.baseColor)
    }
  }

  applyPalette()

  const themeObserver = new MutationObserver(applyPalette)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

  const finishDeparture = () => {
    if (departureFinished) return
    departureFinished = true
    onStation?.()
  }

  const beginDeparture = () => {
    if (departureActive) return
    departureActive = true
    departureElapsed = 0
    firstPerson = false
    restaged = false
    cameraFollowing = false
    voxelFade = 1
    bankRoll = 0
    yawRateSmoothed = 0
    pilotActive = false
    pilot = { speed: 0, yaw: 0, pitch: 0 }
    enterElapsed = -1
    crashElapsed = -1
    respawnGrace = 0
    cameraSnap = false
    scout.visible = true
    heldKeys.clear()
    pilotPointer.active = false
    steerGain = 0
    manualRoll = 0
    barrelRoll = 0
    lookYaw = 0
    lookPitch = 0
    measuredSpeed = 0
    prevShipPos.copy(scout.position)
    Object.assign(chaseArm, CHASE_ARM_TUNNEL)
    chaseZoom = 1
    document.body.classList.add(DEPARTING_BODY_CLASS)
    orbitCameraPos.copy(camera.position)
    orbitTarget.copy(controls.target)
    renderer.domElement.dataset.cameraMode = 'third-person'
    cameraHint.classList.remove('is-visible')
    speedGauge.classList.remove('is-visible')
    portalMarker.classList.remove('is-visible')
    speedFill.style.width = '0%'
    cameraHint.textContent = cameraHintText()
    wingTrails.forEach(({ trail }) => trail.reset())
    exhaustPlumes.forEach((plume) => plume.reset())
    buildFlightCurve({ x: scout.position.x, y: scout.position.y, z: scout.position.z })
    hoveringStation = false
    hoveringShip = false
    draggingShip = false
    pressedStation = false
    controls.enabled = false
    transit.tick(0, false, true)
    shipBracket.visible = false
    stationBracket.visible = false
    leader.line.visible = false
    sign.visible = false
    renderer.domElement.style.cursor = 'default'
  }

  const onPointerMove = (event: PointerEvent) => {
    if (departureActive) return
    setPointer(event)
    if (draggingShip) {
      raycaster.setFromCamera(pointer, camera)
      if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
        stage.worldToLocal(dragPoint)
        scout.position.x = THREE.MathUtils.clamp(dragPoint.x, -SHIP_RANGE.x, SHIP_RANGE.x)
        scout.position.y = THREE.MathUtils.clamp(dragPoint.y, SHIP_RANGE.minY, SHIP_RANGE.maxY)
      }
      return
    }
    hoveringShip = shipHits()
    hoveringStation = !hoveringShip && stationHits()
    refreshCursor()
  }

  const onPointerDown = (event: PointerEvent) => {
    if (departureActive) return
    setPointer(event)
    if (shipHits()) {
      draggingShip = true
      controls.enabled = false
      scout.getWorldPosition(worldTmp)
      dragPlane.setFromNormalAndCoplanarPoint(dragNormal, worldTmp)
      refreshCursor()
      return
    }
    pressedStation = stationHits()
    if (pressedStation) {
      controls.enabled = false
      renderer.domElement.style.cursor = 'pointer'
      return
    }
    renderer.domElement.style.cursor = 'grabbing'
  }

  const onPointerUp = (event: PointerEvent) => {
    if (departureActive) return
    setPointer(event)
    if (draggingShip) {
      draggingShip = false
      controls.enabled = true
      hoveringShip = shipHits()
      refreshCursor()
      return
    }
    if (pressedStation && stationHits()) {
      beginDeparture()
      return
    }
    pressedStation = false
    controls.enabled = true
    hoveringStation = stationHits()
    refreshCursor()
  }

  /** 驾驶键位：W/S 油门、Shift 加力、A/D 滚转、Q/E 翻滚、Alt 观察，方向键是没鼠标时的转向备份。 */
  const PILOT_KEYS = new Set([
    'KeyW',
    'KeyA',
    'KeyS',
    'KeyD',
    'KeyQ',
    'KeyE',
    'ShiftLeft',
    'ShiftRight',
    'AltLeft',
    'AltRight',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
  ])

  const onKeyDown = (event: KeyboardEvent) => {
    if (!departureActive) return
    if (PILOT_KEYS.has(event.code)) {
      heldKeys.add(event.code)
      if (pilotActive && (event.code.startsWith('Arrow') || event.code.startsWith('Alt') || event.code.startsWith('Shift'))) {
        event.preventDefault()
      }
      if (event.code.startsWith('Alt')) {
        pilotPointer.active = false
      }
      return
    }
    if (!restaged || event.code !== 'KeyV') return
    firstPerson = !firstPerson
    renderer.domElement.dataset.cameraMode = firstPerson ? 'first-person' : 'third-person'
    cameraHint.textContent = cameraHintText()
  }
  const onKeyUp = (event: KeyboardEvent) => {
    heldKeys.delete(event.code)
    if (event.code.startsWith('Alt')) pilotPointer.active = false
  }
  const onBlur = () => {
    heldKeys.clear()
    pilotPointer.active = false
  }
  /** 第三人称追尾时滚轮拉近/拉远；OrbitControls 此时已禁用，所以要自己吞掉滚动。 */
  const onWheel = (event: WheelEvent) => {
    if (!departureActive || !cameraFollowing || firstPerson) return
    event.preventDefault()
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
    chaseZoom = THREE.MathUtils.clamp(chaseZoom * Math.exp(delta * CHASE_ZOOM.rate), CHASE_ZOOM.min, CHASE_ZOOM.max)
  }

  const lookingAround = () => heldKeys.has('AltLeft') || heldKeys.has('AltRight')

  /** 鼠标转向：记录指针相对画布中心的归一化偏移（右、上为正）。按住 Alt 时改成观察，不转舵。 */
  const onPilotPointerMove = (event: PointerEvent) => {
    if (!pilotActive) return
    if (lookingAround() || event.altKey) {
      lookYaw -= event.movementX * PILOT.lookSensitivity
      if (lookYaw > Math.PI) lookYaw -= Math.PI * 2
      if (lookYaw < -Math.PI) lookYaw += Math.PI * 2
      lookPitch = THREE.MathUtils.clamp(lookPitch + event.movementY * PILOT.lookSensitivity, -PILOT.lookPitchMax, PILOT.lookPitchMax)
      pilotPointer.active = false
      return
    }
    const rect = renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    pilotPointer.nx = THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1)
    pilotPointer.ny = THREE.MathUtils.clamp(1 - ((event.clientY - rect.top) / rect.height) * 2, -1, 1)
    pilotPointer.active = true
  }
  const onPilotPointerLeave = () => {
    pilotPointer.active = false
  }

  /**
   * 归约输入：方向键优先于鼠标做舵量（满舵），否则用鼠标偏移；W/S 是油门；Shift 加力；
   * A/D 滚转，Q/E 翻滚。按住 Alt 观察时鼠标不转舵。
   */
  const readPilotInput = () => {
    const has = (code: string) => heldKeys.has(code)
    const keyYaw = (has('ArrowLeft') ? 1 : 0) - (has('ArrowRight') ? 1 : 0)
    const keyPitch = (has('ArrowUp') ? 1 : 0) - (has('ArrowDown') ? 1 : 0)
    const mouse = !lookingAround() && pilotPointer.active
      ? steerFromPointer(pilotPointer.nx, pilotPointer.ny)
      : { yaw: 0, pitch: 0 }
    return {
      thrust: (has('KeyW') ? 1 : 0) - (has('KeyS') ? 1 : 0),
      boost: has('ShiftLeft') || has('ShiftRight'),
      yaw: keyYaw !== 0 ? keyYaw : mouse.yaw * steerGain,
      pitch: keyPitch !== 0 ? keyPitch : mouse.pitch * steerGain,
      roll: (has('KeyA') ? 1 : 0) - (has('KeyD') ? 1 : 0),
      barrel: (has('KeyQ') ? 1 : 0) - (has('KeyE') ? 1 : 0),
    }
  }

  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointermove', onPilotPointerMove)
  document.documentElement.addEventListener('pointerleave', onPilotPointerLeave)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  window.addEventListener('wheel', onWheel, { passive: false })

  const viewSize = () => {
    const viewport = window.visualViewport
    const viewW = Math.round(viewport?.width ?? window.innerWidth)
    const viewH = Math.round(viewport?.height ?? window.innerHeight)
    return {
      width: Math.max(host.clientWidth, viewW, 1),
      height: Math.max(host.clientHeight, viewH, 1),
    }
  }

  let tuner: PortalTunerHandle | null = null

  const fit = () => {
    const { width, height } = viewSize()
    const frame = planFactoryFrame(width, height)
    camera.aspect = frame.aspect
    // 远裁剪面要罩住重布景后的传送门（约 156 单位外）以及软边界外缘的机位，否则远处的门会被切掉一半。
    camera.far = Math.max(frame.far, DEPARTURE_FAR)
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    controls.maxDistance = Math.max(220, frame.distance * 1.6)
    // 起飞后镜头归追尾臂管，重新布景后传送门也不再回到构图位。
    if (!departureActive) camera.position.sub(controls.target).setLength(frame.distance).add(controls.target)
    stage.position.y = frame.stageY
    if (restaged) return
    if (tuner?.pinStation) {
      station.position.x = tuner.stationX
      station.position.y = tuner.stationY
    } else {
      station.position.x = frame.stationX
      station.position.y = frame.stationY
    }
  }

  fit()
  tuner = shouldMountPortalTuner()
    ? mountPortalTuner(PORTAL_TILT, { x: station.position.x, y: station.position.y })
    : null
  const portalTilt = tuner?.tilt ?? PORTAL_TILT
  const refit = window.requestAnimationFrame(fit)
  window.visualViewport?.addEventListener('resize', fit)
  window.visualViewport?.addEventListener('scroll', fit)

  const clock = new THREE.Clock()
  let time = 0

  const tick = (scanY: number, animateScan: boolean, scanDepartureElapsed?: number) => {
    if (scanDepartureElapsed === undefined) lastScanY = scanY
    if (animateScan) {
      // 机头对准扫描落点（和光束末端同一点），光幕才垂直从机头射出。
      worldTmp.set(0, scanY, SCAN_IMPACT_Z)
      stage.localToWorld(worldTmp)
      scout.lookAt(worldTmp)
      const scanShape = scanDepartureElapsed === undefined
        ? { width: 1, retract: 0, beam: 0 }
        : sampleScanRetraction(scanDepartureElapsed)
      const flicker = 0.86 + Math.sin(time * 21) * 0.06 + Math.sin(time * 7.3) * 0.08
      impact.mesh.position.set(0, scanY, SCAN_IMPACT_Z)
      impactHalo.mesh.position.set(0, scanY, SCAN_IMPACT_Z - 0.03)
      impact.mesh.scale.x = scanShape.width
      impactHalo.mesh.scale.x = scanShape.width
      impact.material.opacity = flicker * LASER_IMPACT_OPACITY * scanShape.width
      impactHalo.material.opacity = (0.22 + flicker * 0.14) * LASER_IMPACT_OPACITY * scanShape.width

      // 扫描光幕的顶点就是机头那颗发光点；底边贴在扫描底光两端，镜头里才能看成三角形。
      scout.updateMatrixWorld()
      scoutEmitter.getWorldPosition(worldTmp)
      stage.worldToLocal(worldTmp)
      const shipX = worldTmp.x
      const shipY = worldTmp.y
      const shipZ = worldTmp.z
      const fan = scanFanBase(
        { x: shipX, y: shipY, z: shipZ },
        { x: 0, y: scanY, z: SCAN_IMPACT_Z },
        scanShape.width,
        scanShape.retract,
        LASER_HALF,
      )
      const beamEndX = fan.end.x
      const beamEndY = fan.end.y
      const beamEndZ = fan.end.z
      emitter.position.set(shipX, shipY, shipZ)
      emitterMat.opacity = (0.6 + flicker * 0.35) * (1 - scanShape.retract)

      trianglePos[0] = shipX
      trianglePos[1] = shipY
      trianglePos[2] = shipZ
      trianglePos[3] = fan.left.x
      trianglePos[4] = fan.left.y
      trianglePos[5] = fan.left.z
      trianglePos[6] = fan.right.x
      trianglePos[7] = fan.right.y
      trianglePos[8] = fan.right.z
      triangleGeo.attributes.position!.needsUpdate = true
      triangleGeo.computeVertexNormals()
      triangle.visible = scanShape.width > 0.001
      triangleMat.uniforms.uTime!.value = time
      rays.forEach((ray, index) => {
        rayBase[index] = THREE.MathUtils.clamp(ray.center + Math.sin(time * ray.speed + ray.phase) * ray.amp, 0.03, 0.97)
        if (Math.random() < 0.035) ray.target = 0.15 + Math.random() * 0.85
        ray.bright += (ray.target - ray.bright) * 0.12
        rayBright[index] = ray.bright * (0.85 + Math.sin(time * 17 + ray.phase * 3) * 0.15)
      })
      triangleMat.uniforms.uOpacity!.value = 0.42 + (Math.sin(time * 2.4) * 0.5 + 0.5) * 0.16 + (flicker - 0.86) * 0.5

      scanCorePos[0] = shipX
      scanCorePos[1] = shipY
      scanCorePos[2] = shipZ
      scanCorePos[3] = beamEndX
      scanCorePos[4] = beamEndY
      scanCorePos[5] = beamEndZ
      scanCoreGeo.attributes.position!.needsUpdate = true
      scanCore.visible = scanShape.beam > 0.001
      scanCoreMat.opacity = scanShape.beam * (0.72 + flicker * 0.25)
    } else {
      triangle.visible = false
      scanCore.visible = false
      impact.material.opacity = 0
      impactHalo.material.opacity = 0
      emitterMat.opacity = 0
    }

    for (const voxel of voxels) {
      let target = 0
      if (animateScan) {
        const dist = Math.abs(voxel.base.y - scanY)
        if (dist < SCAN_BAND) target = (1 - dist / SCAN_BAND) * SCAN_POP
      }
      voxel.zOffset += (target - voxel.zOffset) * SCAN_LERP
      voxel.mesh.position.set(voxel.base.x, voxel.base.y, voxel.base.z + voxel.zOffset)

      if (voxel.zOffset > 0.18) {
        const glow = Math.min(voxel.zOffset / 1.2, 1)
        voxel.material.color.copy(voxel.baseColor).lerp(palette.lit, glow)
      } else {
        voxel.material.color.lerp(voxel.baseColor, 0.12)
      }
    }
  }

  const updateBracket = (bracket: THREE.LineSegments, material: THREE.LineBasicMaterial, active: boolean) => {
    bracket.quaternion.copy(camera.quaternion)
    const breathe = reducedMotion ? 0 : Math.sin(time * 2.2) * 0.5 + 0.5
    const targetOpacity = active ? 0.95 : 0.22 + breathe * 0.16
    const targetScale = active ? 0.96 : 1.04 + breathe * 0.04
    material.opacity += (targetOpacity - material.opacity) * 0.18
    bracket.scale.setScalar(bracket.scale.x + (targetScale - bracket.scale.x) * 0.18)
  }

  /** 三束尾焰随速度：越快越长、越宽、流得越快、越亮；停下来只剩喷口一点余火。穿 0 时截短到短臂镜头之前。 */
  const updateExhaust = (delta: number, speedRatio: number, fade: number, inTunnel: boolean) => {
    const profile = plumeProfileForSpeed(speedRatio)
    const maxLength = inTunnel ? TUNNEL_PLUME_LENGTH : Infinity
    exhaustPlumes.forEach((plume) => plume.update(delta, profile, fade, maxLength))
  }

  /** 机翼尾迹：记录翼尖位置，再按速度对应的弧长/宽度/亮度重写面向相机的光带，减速时尾迹跟着缩短变细。 */
  const updateWingTrails = (speedRatio: number, fade: number) => {
    const profile = trailProfileForSpeed(speedRatio)
    camera.getWorldPosition(cameraLocalTmp)
    stage.worldToLocal(cameraLocalTmp)
    wingTrails.forEach(({ wingX, trail }) => {
      worldTmp.set(wingX, FIGHTER_WINGTIP.y, FIGHTER_WINGTIP.z)
      scout.localToWorld(worldTmp)
      stage.worldToLocal(worldTmp)
      trail.push(worldTmp.x, worldTmp.y, worldTmp.z)
      trail.update(cameraLocalTmp, profile, fade)
    })
  }

  const updateDeparture = (rawDelta: number) => {
    // 卡顿或切标签回来时把单帧时间钳住，飞船不会一步跳过传送门，物理也不会失控。
    const delta = Math.min(rawDelta, 0.1)
    departureElapsed += delta
    const state = samplePortalDeparture(departureElapsed, reducedMotion)

    if (state.phase === 'fade') {
      renderer.domElement.style.opacity = String(1 - state.progress)
      return
    }
    if (state.phase === 'complete') {
      renderer.domElement.style.opacity = '0'
      cameraHint.classList.remove('is-visible')
      finishDeparture()
      return
    }
    if (state.phase === 'lock' || state.phase === 'collapse') {
      tick(lastScanY, true, departureElapsed)
      // 收光期间机头仍对着扫描线；把这个朝向记为起飞时的初始航向，起飞后从这里连续转过去。
      shipHeading.copy(scout.quaternion)
      return
    }

    tick(lastScanY, false)
    if (!flightCurve || !flightMarks || !cruisePlan) return
    const marks = flightMarks
    const plan = cruisePlan
    prevShipPos.copy(scout.position)

    // 过场：时间进度 → 弧长进度，只飞到左转正对传送门（cruiseStart），末端减速停稳交给玩家。
    let u = 1
    let inTunnel = false
    if (state.phase === 'flight' && !pilotActive) {
      u = flightEase(state.progress) * marks.cruiseStart
      inTunnel = u >= marks.preGate && u <= marks.postGate
      // S6：飞船一过后门就重新布景。传送门此时在视野外，观众看不到这次搬家。
      // 出洞后（点 12 这一段）再搬家并开始转向传送门，洞里观众还看不见。
      if (u >= marks.postGate && !restaged) restageStation()
      sampleFlight(u, scout.position, tangentTmp)
    } else if (enterElapsed >= 0) {
      // 入门：沿当前航向继续滑进门心，机身缩小、门放大、整体淡出。
      enterElapsed += delta
      const dir = headingVector(pilot.yaw, pilot.pitch)
      tangentTmp.set(dir.x, dir.y, dir.z)
      scout.position.addScaledVector(tangentTmp, enterSpeed * delta)
    } else if (crashElapsed >= 0) {
      // 撞机后：机身隐藏、原地不动，镜头停在爆炸点看完，再回巡航起点重来。
      crashElapsed += delta
      const dir = headingVector(pilot.yaw, pilot.pitch)
      tangentTmp.set(dir.x, dir.y, dir.z)
      renderer.domElement.style.opacity = String(
        1 - THREE.MathUtils.smoothstep(crashElapsed, CRASH.respawnDelay - CRASH.fadeIn, CRASH.respawnDelay),
      )
      if (crashElapsed >= CRASH.respawnDelay) respawnPilot(plan)
    } else {
      if (!pilotActive) beginPilot()
      if (pilotPointer.active) steerGain = Math.min(1, steerGain + delta / 0.8)
      const input = readPilotInput()
      pilot = stepPilot(pilot, input, delta)
      pilot = assistHeading(pilot, scout.position, plan.portal, delta, input.yaw !== 0 || input.pitch !== 0)
      manualRoll += (input.roll * PILOT.manualRoll - manualRoll) * (1 - Math.exp(-delta * PILOT.rollRate))
      barrelRoll = stepBarrel(barrelRoll, input.barrel, delta)
      if (!lookingAround()) {
        const lookBack = 1 - Math.exp(-delta * PILOT.lookReturn)
        lookYaw += (0 - lookYaw) * lookBack
        lookPitch += (0 - lookPitch) * lookBack
      }
      const dir = headingVector(pilot.yaw, pilot.pitch)
      tangentTmp.set(dir.x, dir.y, dir.z)
      scout.position.addScaledVector(tangentTmp, pilot.speed * delta)
      // 软边界：离门太远就沿径向拉回，门永远飞得到。
      aheadTmp.set(plan.portal.x, plan.portal.y, plan.portal.z)
      const away = scout.position.distanceTo(aheadTmp)
      if (away > PILOT.leash) scout.position.sub(aheadTmp).multiplyScalar(PILOT.leash / away).add(aheadTmp)
      if (respawnGrace > 0) {
        respawnGrace = Math.max(0, respawnGrace - delta)
        renderer.domElement.style.opacity = String(
          THREE.MathUtils.smoothstep(CRASH.grace - respawnGrace, 0, CRASH.fadeIn),
        )
      }
      // 入门判定用这一帧扫过的线段到门心的最近距离，高速时也不会从门心"穿"过去而漏判。
      sweptPath.set(prevShipPos, scout.position)
      const swept = sweptPath.closestPointToPoint(aheadTmp, true, worldTmp).distanceTo(aheadTmp)
      if (swept < PILOT.entryRadius) {
        enterElapsed = 0
        enterSpeed = Math.max(pilot.speed, 2.6)
        speedGauge.classList.remove('is-visible')
      } else if (respawnGrace <= 0) {
        // 撞上航道里排队进门的船就炸：机身球和船的碰撞球都换算到门局部坐标比较。
        const hit = findTransitCollision(shipInPortalSpace(), transit.colliders(), shipRadiusInPortalSpace())
        if (hit >= 0) crashPilot(hit)
      }
    }

    // 机头只用偏航/俯仰（不带 lookAt 的附加滚转），滚转单独由压坡度叠上去，转弯才不会一卡一卡。
    headingEuler.set(
      -Math.asin(THREE.MathUtils.clamp(tangentTmp.y, -1, 1)),
      Math.atan2(tangentTmp.x, tangentTmp.z),
      0,
    )
    headingTarget.setFromEuler(headingEuler)
    const headingRate = !pilotActive && u >= marks.postGate
      ? HEADING_TURN.align
      : u < marks.preGate && !pilotActive
        ? HEADING_TURN.takeoff
        : HEADING_TURN.flight
    const turnRate = 1 - Math.exp(-delta * headingRate)
    shipHeading.slerp(headingTarget, turnRate)
    scout.quaternion.copy(shipHeading)

    // 滚转跟随平滑后的偏航角速度：转得越急压坡度越大，直线段自动回平。洞内强制水平。
    forwardTmp.set(0, 0, 1).applyQuaternion(shipHeading)
    const yaw = Math.atan2(forwardTmp.x, forwardTmp.z)
    let yawDelta = yaw - prevYaw
    if (yawDelta > Math.PI) yawDelta -= Math.PI * 2
    if (yawDelta < -Math.PI) yawDelta += Math.PI * 2
    prevYaw = yaw
    if (delta > 0) yawRateSmoothed += (yawDelta / delta - yawRateSmoothed) * (1 - Math.exp(-delta * 6))
    const rollTarget = inTunnel || delta <= 0
      ? 0
      : THREE.MathUtils.clamp(yawRateSmoothed * BANK_GAIN, -BANK_ROLL, BANK_ROLL)
    bankRoll += (rollTarget - bankRoll) * (1 - Math.exp(-delta * (inTunnel ? 10 : 5)))

    const enterProgress = enterElapsed >= 0 ? Math.min(1, enterElapsed / PILOT.enterDuration) : 0
    scout.scale.setScalar(1 - THREE.MathUtils.smoothstep(enterProgress, 0.2, 1) * 0.92)

    // 第三人称的弹簧臂按未滚转的机身算，镜头不跟着压坡度；第一人称在滚转之后算，座舱一起倾斜。
    if (!firstPerson) updateChaseCamera(delta, u)
    scout.rotateZ(-(bankRoll + manualRoll + barrelRoll))
    if (firstPerson) updateChaseCamera(delta, u)

    // 实测机速驱动尾焰与尾迹，过场与驾驶阶段同一套表现。
    if (delta > 0) {
      const rawSpeed = scout.position.distanceTo(prevShipPos) / delta
      measuredSpeed += (rawSpeed - measuredSpeed) * (1 - Math.exp(-delta * 9))
    }
    const speedRatio = THREE.MathUtils.clamp(measuredSpeed / PILOT.maxSpeed, 0, PILOT.boostMax / PILOT.maxSpeed)
    if (crashElapsed < 0) {
      updateExhaust(delta, speedRatio, 1 - enterProgress, inTunnel)
      updateWingTrails(speedRatio, 1 - enterProgress)
    }
    explosion.update(delta)
    updateVoxelFade(delta)
    if (pilotActive) {
      speedFill.style.width = `${(THREE.MathUtils.clamp(pilot.speed / PILOT.boostMax, 0, 1) * 100).toFixed(1)}%`
      updatePortalMarker(enterElapsed < 0 && crashElapsed < 0)
    }

    // 重布景后穿门飞船改走进港航道：慢速排队进门，玩家要从队伍里穿过去。
    if (restaged) transit.tick(delta, false, reducedMotion, { depth: laneSpawnDepth, avoid: shipInPortalSpace() })

    if (enterProgress > 0) {
      portal.scale.setScalar(1 + THREE.MathUtils.smoothstep(enterProgress, 0, 1) * 0.55)
      const fade = 1 - THREE.MathUtils.smoothstep(enterProgress, 0.62, 1)
      renderer.domElement.style.opacity = String(fade)
      cameraHint.style.opacity = String(fade)
      if (enterProgress >= 1) {
        renderer.domElement.style.opacity = '0'
        cameraHint.classList.remove('is-visible')
        finishDeparture()
      }
    }
  }

  /** 传送门在画面内就隐藏箭头；出画或在身后时，箭头贴到画面边缘、指向门的方向。 */
  function updatePortalMarker(enabled: boolean) {
    if (!enabled) {
      portalMarker.classList.remove('is-visible')
      return
    }
    station.getWorldPosition(worldTmp).project(camera)
    const behind = worldTmp.z > 1
    let x = behind ? -worldTmp.x : worldTmp.x
    let y = behind ? -worldTmp.y : worldTmp.y
    if (!behind && Math.abs(x) < 0.9 && Math.abs(y) < 0.84) {
      portalMarker.classList.remove('is-visible')
      return
    }
    // 沿画面中心到门的方向推到边缘框上（留出安全边距），保持方向不变。
    const length = Math.hypot(x, y) || 1
    x /= length
    y /= length
    const edge = Math.max(Math.abs(x) / 0.9, Math.abs(y) / 0.84)
    const px = ((x / edge + 1) / 2) * renderer.domElement.clientWidth
    const py = ((1 - y / edge) / 2) * renderer.domElement.clientHeight
    const rotate = 90 - (Math.atan2(y, x) * 180) / Math.PI
    portalMarker.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -50%) rotate(${rotate.toFixed(1)}deg)`
    portalMarker.classList.add('is-visible')
  }

  /** 机身中心换算到门局部坐标（穿门飞船都住在这个空间里）。返回的是复用的临时向量。 */
  function shipInPortalSpace() {
    worldTmp.copy(scout.position)
    stage.localToWorld(worldTmp)
    portal.worldToLocal(worldTmp)
    return worldTmp
  }

  /** 机身碰撞半径换算到门局部坐标：舞台缩放 / 门的世界缩放。 */
  function shipRadiusInPortalSpace() {
    portal.getWorldScale(cameraLocalTmp)
    return (CRASH.shipRadius * STAGE_SCALE * scout.scale.x) / Math.max(1e-6, cameraLocalTmp.x)
  }

  /** 撞机：被撞的船与玩家一起炸开，机身隐藏，尾焰尾迹清空，等爆炸看完再重生。 */
  function crashPilot(riderIndex: number) {
    transit.explode(riderIndex)
    crashElapsed = 0
    const dir = headingVector(pilot.yaw, pilot.pitch)
    tangentTmp.set(dir.x, dir.y, dir.z)
    explosion.trigger(scout.position, tangentTmp)
    scout.visible = false
    wingTrails.forEach(({ trail }) => trail.reset())
    exhaustPlumes.forEach((plume) => plume.reset())
    speedGauge.classList.remove('is-visible')
    portalMarker.classList.remove('is-visible')
    cameraHint.textContent = '撞上了 · 回到航道起点重来'
  }

  /** 重生：回巡航起点正对传送门，速度归零，镜头直接跳到追尾机位，画面淡入并给一段无敌时间。 */
  function respawnPilot(plan: CruiseStagePlan) {
    crashElapsed = -1
    respawnGrace = CRASH.grace
    cameraSnap = true
    scout.visible = true
    scout.position.set(plan.cruiseStart.x, plan.cruiseStart.y, plan.cruiseStart.z)
    prevShipPos.copy(scout.position)
    const heading = headingFromDirection(plan.direction)
    pilot = { speed: 0, yaw: heading.yaw, pitch: heading.pitch }
    tangentTmp.set(plan.direction.x, plan.direction.y, plan.direction.z)
    prevYaw = Math.atan2(tangentTmp.x, tangentTmp.z)
    bankRoll = 0
    yawRateSmoothed = 0
    manualRoll = 0
    barrelRoll = 0
    lookYaw = 0
    lookPitch = 0
    measuredSpeed = 0
    renderer.domElement.style.opacity = '0'
    cameraHint.textContent = cameraHintText()
    speedGauge.classList.add('is-visible')
  }

  /** S8：过场结束，飞船停在巡航起点正对传送门，交给玩家。航向取自样条末端切线。 */
  function beginPilot() {
    pilotActive = true
    // 位置取对准曲线终点，航向直接用巡航起点 → 门心的方向。
    if (flightAlign) scout.position.set(flightAlign.end.x, flightAlign.end.y, flightAlign.end.z)
    const direction = cruisePlan?.direction ?? { x: tangentTmp.x, y: tangentTmp.y, z: tangentTmp.z }
    tangentTmp.set(direction.x, direction.y, direction.z)
    const heading = headingFromDirection(direction)
    pilot = { speed: 0, yaw: heading.yaw, pitch: heading.pitch }
    cameraHint.textContent = cameraHintText()
    cameraHint.classList.add('is-visible')
    speedGauge.classList.add('is-visible')
    renderer.domElement.style.cursor = 'crosshair'
  }

  /** 起飞时按当前机位铺穿 0 前的样条，出洞后接解析对准曲线；航路点换成整段弧长进度。 */
  function buildFlightCurve(start: Point3) {
    const plan = planCruiseStage(ZERO_PASS_POINT)
    const { points, marks, align } = buildDepartureWaypoints(start, ZERO_PASS_POINT, plan, {
      x: 0,
      y: lastScanY,
      z: SCAN_IMPACT_Z,
    })
    cruisePlan = plan
    flightAlign = align
    const approach = points.slice(0, marks.postGate + 1).map((p) => new THREE.Vector3(p.x, p.y, p.z))
    const curve = new THREE.CatmullRomCurve3(approach, false, 'centripetal')
    curve.arcLengthDivisions = 600
    const lengths = curve.getLengths(curve.arcLengthDivisions)
    const approachLen = lengths[lengths.length - 1] || 1
    const total = approachLen + align.length
    const segments = approach.length - 1
    const arcAt = (index: number) => {
      const t = index / segments
      const sample = Math.min(lengths.length - 1, Math.round(t * curve.arcLengthDivisions))
      return lengths[sample]! / total
    }
    flightCurve = curve
    flightApproachLen = approachLen
    flightTotalLen = total
    flightMarks = {
      lifted: arcAt(marks.lifted),
      follow: arcAt(marks.follow),
      preGate: arcAt(marks.preGate),
      frontGate: arcAt(marks.frontGate),
      backGate: arcAt(marks.backGate),
      postGate: approachLen / total,
      cruiseStart: 1,
      cruiseEnd: 1,
      portal: 1,
    }
    curve.getTangentAt(0, tangentTmp)
    prevYaw = Math.atan2(tangentTmp.x, tangentTmp.z)
    yawRateSmoothed = 0
  }

  /** 弧长进度 → 位置和机头方向。出洞前看向航路前方，出洞后用对准曲线自己的切线。 */
  function sampleFlight(u: number, pos: THREE.Vector3, tan: THREE.Vector3) {
    if (!flightCurve || !flightAlign) return
    const progress = Math.min(1, Math.max(0, u))
    const along = progress * flightTotalLen
    if (along <= flightApproachLen) {
      const approachU = along / flightApproachLen
      flightCurve.getPointAt(approachU, pos)
      const lookCap = flightApproachLen
      const look = Math.min(lookCap, along + HEADING_LOOKAHEAD)
      if (look - along < 1e-4) {
        flightCurve.getTangentAt(approachU, tan)
      } else {
        flightCurve.getPointAt(look / flightApproachLen, lookAheadTmp)
        tan.subVectors(lookAheadTmp, pos)
        if (tan.lengthSq() < 1e-8) flightCurve.getTangentAt(approachU, tan)
        else tan.normalize()
      }
      return
    }
    const sample = flightAlign.sample(along - flightApproachLen)
    pos.set(sample.point.x, sample.point.y, sample.point.z)
    tan.set(sample.tangent.x, sample.tangent.y, sample.tangent.z)
  }

  /** S6：把 station 搬到出洞航向的左前远方，门面正对飞船来向。 */
  function restageStation() {
    const plan = cruisePlan ?? planCruiseStage(ZERO_PASS_POINT)
    cruisePlan = plan
    restaged = true
    worldTmp.set(plan.portal.x, plan.portal.y, plan.portal.z)
    stage.localToWorld(worldTmp)
    station.position.copy(worldTmp)
    station.scale.setScalar(RESTAGED_STATION_SCALE)
    portal.scale.setScalar(1)
    // 航道生成点：接手点 → 门心路程的 3/4 处，换算成门局部深度（门的世界缩放 = station 缩放 × 门缩放）。
    const route = Math.hypot(
      plan.portal.x - plan.cruiseStart.x,
      plan.portal.y - plan.cruiseStart.y,
      plan.portal.z - plan.cruiseStart.z,
    )
    laneSpawnDepth = (route * (1 - TRANSIT_LANE.spawnFraction) * STAGE_SCALE) / RESTAGED_STATION_SCALE
    // 门的 +z 朝飞船来向（-direction）。lookAt 会考虑父级变换。
    aheadTmp.set(plan.portal.x - plan.direction.x * 10, plan.portal.y - plan.direction.y * 10, plan.portal.z - plan.direction.z * 10)
    stage.localToWorld(aheadTmp)
    portal.lookAt(aheadTmp)
    // 操作提示等接手（beginPilot）时再一起出现，过场里不单独弹 V 的提示。
  }

  /**
   * 镜头交接与追尾，全部以弧长进度 u 做阈值。
   * 拉近段结束后开始从轨道机位向短臂追尾混合，到前门前接管完毕；出洞后臂长渐变到巡航臂，
   * 并带指数阻尼，转弯时机身会先摆出画面再被拉回，这就是飞行游戏的手感。
   */
  function updateChaseCamera(delta: number, u: number) {
    if (!flightMarks) return
    const marks = flightMarks
    if (u < marks.follow) return

    // 接近 0 才开始缓慢拉进追尾，穿洞过程里交接完。
    const handoffStart = marks.follow
    const handoffEnd = marks.frontGate
    const inHandoff = u < handoffEnd

    const armTarget = firstPerson
      ? COCKPIT_ARM
      : pilotActive
        ? CHASE_ARM_PILOT
        : u < marks.postGate
          ? CHASE_ARM_TUNNEL
          : CHASE_ARM_CRUISE
    const armRate = 1 - Math.exp(-delta * (firstPerson ? 8 : pilotActive ? 1.6 : 2.2))
    chaseArm.behind += (armTarget.behind - chaseArm.behind) * armRate
    chaseArm.above += (armTarget.above - chaseArm.above) * armRate
    chaseArm.side += (armTarget.side - chaseArm.side) * armRate
    chaseArm.ahead += (armTarget.ahead - chaseArm.ahead) * armRate

    const zoom = firstPerson ? 1 : chaseZoom
    lookEuler.set(lookPitch, lookYaw, 0)
    lookQuat.setFromEuler(lookEuler)
    desiredCamera.set(chaseArm.side * zoom, chaseArm.above * zoom, -chaseArm.behind * zoom).applyQuaternion(lookQuat)
    scout.localToWorld(desiredCamera)
    desiredLook.set(0, firstPerson ? 0.08 : 0.25, chaseArm.ahead).applyQuaternion(lookQuat)
    scout.localToWorld(desiredLook)

    if (inHandoff) {
      // S4：交接。混合权重只随弧长走，不受帧率影响。
      const blend = THREE.MathUtils.smoothstep(u, handoffStart, handoffEnd)
      camera.position.lerpVectors(orbitCameraPos, desiredCamera, blend)
      controls.target.lerpVectors(orbitTarget, desiredLook, blend)
      cameraFollowing = blend > 0.001
      camera.up.set(0, 1, 0)
      camera.lookAt(controls.target)
      return
    }

    cameraFollowing = true
    if (cameraSnap) {
      cameraSnap = false
      camera.position.copy(desiredCamera)
      controls.target.copy(desiredLook)
    }
    const followRate = firstPerson ? 9 : u < marks.postGate ? 7 : 3.2
    const follow = 1 - Math.exp(-delta * followRate)
    camera.position.lerp(desiredCamera, follow)
    controls.target.lerp(desiredLook, follow)
    if (firstPerson) {
      scout.getWorldQuaternion(desiredQuat).multiply(FLIP_Y).multiply(lookQuat)
      camera.quaternion.slerp(desiredQuat, follow)
    } else {
      camera.up.set(0, 1, 0)
      camera.lookAt(controls.target)
    }
  }

  /** S6：飞船出洞（重新布景）那一刻起，404 整体淡出并移除；镜头此时还在洞里，会看到四壁溶解。 */
  function updateVoxelFade(delta: number) {
    if (voxelFade <= 0 || !restaged) return
    if (voxelFade >= 1) {
      for (const voxel of voxels) {
        voxel.material.transparent = true
        voxel.material.depthWrite = false
        voxel.material.needsUpdate = true
      }
    }
    voxelFade = Math.max(0, voxelFade - delta * 3)
    for (const voxel of voxels) {
      voxel.material.opacity = voxelFade
      voxel.mesh.visible = voxelFade > 0
      voxel.mesh.castShadow = false
    }
  }

  renderer.setAnimationLoop(() => {
    const delta = clock.getDelta()
    if (!reducedMotion) {
      time += delta * FACTORY_SPEED
      if (!departureActive) tick(Math.sin(time * SCAN_SPEED) * SCAN_AMPLITUDE, true)
    }

    // 空间门的 hover 动效：转正、微放大、光圈提速、亮度抬升，都跟着 hoverAmount 平滑过渡。
    const hoverGoal = !departureActive && (tuner?.forceHover || hoveringStation) ? 1 : 0
    hoverAmount = reducedMotion ? hoverGoal : hoverAmount + (hoverGoal - hoverAmount) * Math.min(1, delta * 7)
    const wobble = reducedMotion || tuner?.freezeWobble ? 0 : Math.sin(time * 0.7) * 0.05
    const wobbleX = reducedMotion || tuner?.freezeWobble ? 0 : Math.cos(time * 0.55) * 0.03
    if (!restaged) {
      portal.rotation.y = THREE.MathUtils.lerp(portalTilt.y, portalTilt.hoverY, hoverAmount) + wobble * (1 - hoverAmount)
      portal.rotation.x = THREE.MathUtils.lerp(portalTilt.x, portalTilt.hoverX, hoverAmount) + wobbleX * (1 - hoverAmount)
      portal.rotation.z = THREE.MathUtils.lerp(portalTilt.z, portalTilt.hoverZ, hoverAmount)
      portal.scale.setScalar(1 + hoverAmount * 0.08)
    }
    const spin = reducedMotion ? 0 : delta * (1 + hoverAmount * 1.8)
    rings.forEach((ring) => {
      ring.angle += spin * ring.speed
      ring.group.rotation.z = ring.angle
      ring.material.opacity = ring.baseOpacity + hoverAmount * 0.12
    })
    veil.rotation.z += spin * 0.12
    sparks.rotation.z -= spin * 0.22
    const pulse = reducedMotion ? 0.5 : Math.sin(time * 1.6) * 0.5 + 0.5
    veilMat.opacity = 0.55 + pulse * 0.15 + hoverAmount * 0.28
    sparkMat.opacity = 0.65 + (reducedMotion ? 0.15 : (Math.sin(time * 4.2) * 0.5 + 0.5) * 0.3) + hoverAmount * 0.2
    if (!departureActive) transit.tick(delta, hoverAmount > 0.35, reducedMotion)

    // 悬停空间门：先从门那头把折线画完，再让便签浮出来；移开时反向收回。
    const leaderTarget = !departureActive && hoveringStation ? 1 : 0
    if (reducedMotion) leaderProgress = leaderTarget
    else leaderProgress = THREE.MathUtils.clamp(leaderProgress + (leaderTarget ? delta * 2.6 : -delta * 4.5), 0, 1)
    leader.setProgress(leaderProgress)
    leader.line.visible = !departureActive && leaderProgress > 0.001
    signTarget = leaderProgress >= 1 ? 1 : 0
    signMat.opacity += (signTarget - signMat.opacity) * (reducedMotion ? 1 : 0.18)
    sign.visible = !departureActive && signMat.opacity > 0.02
    sign.scale.setScalar(0.92 + signMat.opacity * 0.08)

    if (!departureActive) {
      shipBracket.position.copy(scout.position)
      updateBracket(shipBracket, shipBracketMat, hoveringShip || draggingShip)
      updateBracket(stationBracket, bracketMat, hoveringStation)
    }

    if (departureActive) updateDeparture(delta)

    if (tuner?.pinStation && !restaged) {
      station.position.x = tuner.stationX
      station.position.y = tuner.stationY
    }
    tuner?.update({
      rotX: portal.rotation.x,
      rotY: portal.rotation.y,
      rotZ: portal.rotation.z,
      hover: hoverAmount,
      stationX: station.position.x,
      stationY: station.position.y,
    })
    // 追尾期间镜头由弹簧臂直接摆放；OrbitControls.update 会按 minDistance 把机位弹回去，必须跳过。
    if (!cameraFollowing) controls.update()
    renderer.render(scene, camera)
  })

  const observer = new ResizeObserver(fit)
  observer.observe(host)

  return () => {
    tuner?.dispose()
    transit.dispose()
    window.cancelAnimationFrame(refit)
    window.visualViewport?.removeEventListener('resize', fit)
    window.visualViewport?.removeEventListener('scroll', fit)
    themeObserver.disconnect()
    observer.disconnect()
    renderer.domElement.removeEventListener('pointermove', onPointerMove)
    renderer.domElement.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointermove', onPilotPointerMove)
    document.documentElement.removeEventListener('pointerleave', onPilotPointerLeave)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('wheel', onWheel)
    renderer.setAnimationLoop(null)
    controls.dispose()
    voxels.forEach((voxel) => {
      stage.remove(voxel.mesh)
      voxel.material.dispose()
    })
    cubeGeo.dispose()
    faceMaterial.dispose()
    sideMaterial.dispose()
    veilMat.dispose()
    veilGeo.dispose()
    ringGeo.dispose()
    rings.forEach((ring) => {
      ring.material.dispose()
      if (ring.tube) (ring.tube.material as THREE.MeshBasicMaterial).dispose()
    })
    ringTubeGeos.forEach((geometry) => geometry.dispose())
    ringTextures.forEach((texture) => texture.dispose())
    bracketMat.dispose()
    shipBracketMat.dispose()
    shipBracket.geometry.dispose()
    stationBracket.geometry.dispose()
    leaderMat.dispose()
    leader.geometry.dispose()
    shipHitGeo.dispose()
    shipHitMat.dispose()
    sparkGeo.dispose()
    sparkMat.dispose()
    hitGeo.dispose()
    hitMat.dispose()
    signGeo.dispose()
    signMat.dispose()
    signTexture.dispose()
    portalTexture.dispose()
    impact.geometry.dispose()
    impact.material.dispose()
    impactHalo.geometry.dispose()
    impactHalo.material.dispose()
    emitterMat.dispose()
    glowTexture.dispose()
    laserTexture.dispose()
    holoTexture.dispose()
    triangleGeo.dispose()
    triangleMat.dispose()
    scanCoreGeo.dispose()
    scanCoreMat.dispose()
    engineGlowMat.dispose()
    scoutHull.dispose()
    scoutTrim.dispose()
    exhaustPlumes.forEach((plume) => {
      scout.remove(plume.group)
      plume.dispose()
    })
    wingTrails.forEach(({ trail }) => {
      stage.remove(trail.group)
      trail.dispose()
    })
    stage.remove(explosion.group)
    explosion.dispose()
    scout.traverse((child) => {
      if (child instanceof THREE.Mesh) child.geometry.dispose()
    })
    renderer.dispose()
    renderer.domElement.remove()
    cameraHint.remove()
    speedGauge.remove()
    portalMarker.remove()
    document.body.classList.remove(DEPARTING_BODY_CLASS)
  }
}
