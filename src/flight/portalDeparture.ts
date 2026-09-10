import type { Point3 } from '../core/types'

export type { Point3 }

export type PortalDeparturePhase = 'lock' | 'collapse' | 'flight' | 'pilot' | 'fade' | 'complete'

export type DepartureSegmentPhase = Exclude<PortalDeparturePhase, 'pilot' | 'fade' | 'complete'>

/**
 * 三段时长（秒）：锁定、收束扫描光、一段连续的过场飞行（到左转正对传送门为止）。
 * 之后进入 pilot（玩家驾驶），不再由时间推进；入门与淡出由场景在玩家飞进门时触发。
 */
export const DEPARTURE_SEGMENTS: ReadonlyArray<{ phase: DepartureSegmentPhase; duration: number }> = [
  { phase: 'lock', duration: 0.25 },
  { phase: 'collapse', duration: 0.9 },
  { phase: 'flight', duration: 8.8 },
]

/** 玩家驾驶参数：速度单位 / 秒，角速度 rad / 秒，长度为舞台局部单位。 */
export const PILOT = {
  maxSpeed: 6.5,
  /** W 加速、S 刹车、都松开时的滑行衰减。 */
  accel: 3.2,
  brake: 4.6,
  coast: 1.4,
  /** Shift 加力：更高速度上限与加速度；松开后若超巡航速度会掉回上限。 */
  boostMax: 10.4,
  boostAccel: 6.2,
  boostBleed: 3.6,
  yawRate: 1.2,
  pitchRate: 0.9,
  maxPitch: 1.05,
  /** A/D 手动滚转的最大角度与跟随速率。 */
  manualRoll: 0.9,
  rollRate: 5,
  /** Q/E 连续翻滚（弧度 / 秒）；松开后回正到最近的水平。 */
  barrelRate: 4.5,
  barrelReturn: 6,
  /** Alt + 鼠标观察：每像素弧度、俯仰限位、松手回正速率。 */
  lookSensitivity: 0.0045,
  lookPitchMax: 1.2,
  lookReturn: 8,
  /** 鼠标转向：指针离画面中心的归一化偏移，小于 deadZone 视为直飞，到 fullZone 满舵。 */
  steerDeadZone: 0.06,
  steerFullZone: 0.55,
  /** 离传送门中心的软边界，飞出去会被拉回来，保证门始终在可达范围（要大于巡航直线长度）。 */
  leash: 180,
  /** 机身中心进入门心这个半径内就算入门（重布景后门环半径约 1.18 × 7.8 ≈ 9.2）。 */
  entryRadius: 7.2,
  /** 入门动画时长（秒）。 */
  enterDuration: 1.2,
  /** 辅助瞄准：松开方向键、且门在机头前这个锥角内、距离这个范围内时，航向轻轻向门心靠。 */
  assistRange: 40,
  assistCone: 0.6,
  assistRate: 4,
} as const

export type PilotState = { speed: number; yaw: number; pitch: number }
/** thrust：W 为 1、S 为 -1、都不按为 0；yaw / pitch 为 [-1, 1] 的连续舵量（鼠标或方向键）。 */
export type PilotInput = { thrust: number; yaw: number; pitch: number; boost?: boolean }

/** 扫描光收束的关键时刻，与前两段时长保持一致。 */
export const PORTAL_DEPARTURE_TIMING = {
  lockEnd: 0.25,
  beamFormed: 0.7,
  collapseEnd: 1.15,
  reducedMotionComplete: 0.2,
} as const

/** 0 的前门 / 后门离体素平面的距离，飞船和镜头在这两点之间只走直线。 */
export const ZERO_GATE_DEPTH = 1.35
/** 扫描光打在 404 面上的 z（舞台局部）。机头 lookAt 和光束末端共用，光束才沿机头射出。 */
export const SCAN_IMPACT_Z = 1.25
/** 收光后沿机头方向冲出的距离；样条起点切线因此和收光时的朝向一致，不会掉头。 */
export const TAKEOFF_DASH = 1.8
/** 冲出后的斤斗：半径、扫过角度、采样点数。圈在远离 0 的斜上方，出来再划弧穿 0。 */
export const TAKEOFF_LOOP = { radius: 2.55, sweep: Math.PI * 1.62, samples: 6 } as const

export function takeoffHeading(start: Point3, aim: Point3): Point3 {
  const x = aim.x - start.x
  const y = aim.y - start.y
  const z = aim.z - start.z
  const length = Math.hypot(x, y, z) || 1
  return { x: x / length, y: y / length, z: z / length }
}

/** 沿机头冲出的航路点。若会扎进体素平面就缩短，保证还在 0 的前门之外。 */
export function takeoffDashPoint(start: Point3, aim: Point3, distance = TAKEOFF_DASH): Point3 {
  const heading = takeoffHeading(start, aim)
  const floor = ZERO_GATE_DEPTH + 0.4
  let travel = distance
  if (heading.z < 0 && start.z > floor) travel = Math.min(travel, Math.max(0.35, (start.z - floor) / -heading.z))
  return {
    x: start.x + heading.x * travel,
    y: start.y + heading.y * travel,
    z: start.z + heading.z * travel,
  }
}

function normalize3(x: number, y: number, z: number): Point3 {
  const length = Math.hypot(x, y, z) || 1
  return { x: x / length, y: y / length, z: z / length }
}

export function slerpDir(from: Point3, to: Point3, t: number): Point3 {
  const clamped = Math.min(1, Math.max(0, t))
  const dot = Math.min(1, Math.max(-1, from.x * to.x + from.y * to.y + from.z * to.z))
  const omega = Math.acos(dot)
  if (omega < 1e-4) return { ...from }
  const sine = Math.sin(omega)
  const w0 = Math.sin((1 - clamped) * omega) / sine
  const w1 = Math.sin(clamped * omega) / sine
  return normalize3(from.x * w0 + to.x * w1, from.y * w0 + to.y * w1, from.z * w0 + to.z * w1)
}

/**
 * 斤斗回环：圆心按「当前位置相对 0」放在外侧斜上方（远离 0 + 向上 + 略朝镜头）。
 * 切入切线 = 冲出航向，扫过大半圈后从外侧准备划弧进 0，全程在体素前方。
 */
export function takeoffLoopPoints(inward: Point3, heading: Point3, zero: Point3, radius = TAKEOFF_LOOP.radius): Point3[] {
  const awayX = inward.x - zero.x
  const awayY = inward.y - zero.y
  const away = Math.hypot(awayX, awayY) || 1
  const raw = { x: (awayX / away) * 0.95, y: 1.1, z: 0.42 }
  const along = raw.x * heading.x + raw.y * heading.y + raw.z * heading.z
  const outward = normalize3(raw.x - heading.x * along, raw.y - heading.y * along, raw.z - heading.z * along)
  const ux = -outward.x
  const uy = -outward.y
  const uz = -outward.z
  const center = { x: inward.x - ux * radius, y: inward.y - uy * radius, z: inward.z - uz * radius }
  const floor = ZERO_GATE_DEPTH + 0.45
  const points: Point3[] = []
  for (let i = 1; i <= TAKEOFF_LOOP.samples; i += 1) {
    const theta = (i / TAKEOFF_LOOP.samples) * TAKEOFF_LOOP.sweep
    const cosine = Math.cos(theta)
    const sine = Math.sin(theta)
    points.push({
      x: center.x + radius * (cosine * ux + sine * heading.x),
      y: center.y + radius * (cosine * uy + sine * heading.y),
      z: Math.max(floor, center.z + radius * (cosine * uz + sine * heading.z)),
    })
  }
  return points
}

/** 出洞后先按航向积分左转，再沿门心方向直线接到手点。长度是舞台单位。 */
export const ALIGN_TURN = { length: 20, lead: 12, samples: 32 } as const

export type AlignTurnPath = {
  length: number
  turnLength: number
  end: Point3
  points: Point3[]
  sample: (distance: number) => { point: Point3; tangent: Point3 }
}

function wrapSigned(angle: number) {
  let wrapped = angle
  while (wrapped > Math.PI) wrapped -= Math.PI * 2
  while (wrapped < -Math.PI) wrapped += Math.PI * 2
  return wrapped
}

/** 两端导数为 0，前半段就转完大半航向，进出直线不会在接点处顿一下。 */
export function alignYawEase(u: number) {
  const t = Math.min(1, Math.max(0, u))
  const s = t * t * (3 - 2 * t)
  return s * (2 - s)
}

/**
 * 出洞立刻按平滑航向积分对准传送门：偏航只朝一个方向变，转完锁死，
 * 不再交给 Catmull-Rom 去插值（那会在接手点左右过冲）。
 */
export function buildAlignTurn(
  from: Point3,
  fromDir: Point3,
  toDir: Point3,
  turnLength = ALIGN_TURN.length,
  lead = ALIGN_TURN.lead,
): AlignTurnPath {
  const start = headingFromDirection(fromDir)
  const end = headingFromDirection(toDir)
  const dyaw = wrapSigned(end.yaw - start.yaw)
  const dpitch = end.pitch - start.pitch
  const endDir = headingVector(end.yaw, end.pitch)
  const points: Point3[] = [{ ...from }]
  const tangents: Point3[] = [headingVector(start.yaw, start.pitch)]
  const lengths: number[] = [0]
  let pos = { ...from }
  let travelled = 0
  const steps = ALIGN_TURN.samples
  const ds = turnLength / steps
  for (let i = 0; i < steps; i += 1) {
    const ease = alignYawEase((i + 0.5) / steps)
    const dir = headingVector(start.yaw + dyaw * ease, start.pitch + dpitch * ease)
    pos = { x: pos.x + dir.x * ds, y: pos.y + dir.y * ds, z: pos.z + dir.z * ds }
    travelled += ds
    points.push({ ...pos })
    tangents.push(dir)
    lengths.push(travelled)
  }
  tangents[tangents.length - 1] = endDir
  const leadSteps = 4
  const leadDs = lead / leadSteps
  for (let i = 1; i <= leadSteps; i += 1) {
    pos = { x: pos.x + endDir.x * leadDs, y: pos.y + endDir.y * leadDs, z: pos.z + endDir.z * leadDs }
    travelled += leadDs
    points.push({ ...pos })
    tangents.push(endDir)
    lengths.push(travelled)
  }
  const length = turnLength + lead
  return {
    length,
    turnLength,
    end: { ...pos },
    points,
    sample(distance: number) {
      const target = Math.min(length, Math.max(0, distance))
      if (target <= 0) return { point: { ...points[0]! }, tangent: { ...tangents[0]! } }
      if (target >= length) return { point: { ...pos }, tangent: { ...endDir } }
      let index = 1
      while (index < lengths.length && lengths[index]! < target) index += 1
      const prev = index - 1
      const span = (lengths[index]! - lengths[prev]!) || 1
      const mix = (target - lengths[prev]!) / span
      const a = points[prev]!
      const b = points[index]!
      const ta = tangents[prev]!
      const tb = tangents[index]!
      const tangent = normalize3(
        ta.x + (tb.x - ta.x) * mix,
        ta.y + (tb.y - ta.y) * mix,
        ta.z + (tb.z - ta.z) * mix,
      )
      return {
        point: {
          x: a.x + (b.x - a.x) * mix,
          y: a.y + (b.y - a.y) * mix,
          z: a.z + (b.z - a.z) * mix,
        },
        tangent,
      }
    },
  }
}

/**
 * 出洞对准航路点（给测试和调试用）。接手位置由航向积分决定，不强行穿到旧的 cruiseStart。
 */
export function alignTurnPoints(from: Point3, fromDir: Point3, _to: Point3, toDir: Point3): Point3[] {
  return buildAlignTurn(from, fromDir, toDir).points
}

/**
 * 扫描光幕：顶点在机头，底边贴在扫描底光上（沿 X，和 404 面同一深度）。
 * width 把底边收成一点，retract 再把这一点沿落点→机头缩回。
 */
export function scanFanBase(emitter: Point3, impact: Point3, width: number, retract: number, half: number) {
  const end = {
    x: impact.x + (emitter.x - impact.x) * retract,
    y: impact.y + (emitter.y - impact.y) * retract,
    z: impact.z + (emitter.z - impact.z) * retract,
  }
  const span = half * width
  return {
    end,
    left: { x: end.x - span, y: end.y, z: end.z },
    right: { x: end.x + span, y: end.y, z: end.z },
  }
}
/** 出洞后的重新布景：传送门相对出洞点的偏移、巡航直线长度、入门前的停顿距离、转弯切线长度。 */
export const CRUISE_STAGE = {
  // 门放到约 150 单位外、出洞航向左前约 40°，过场只飞到离门 124 的巡航起点，剩下的路交给玩家（全速约 19 秒）。
  portalOffset: { x: -95, y: 8, z: -120 },
  cruiseLength: 124,
  entryGap: 8,
  tangent: 3.5,
  /** 巡航起点之前再放一段与航向共线的直线，样条到接手点时机头必然正对门心。 */
  lead: 3,
} as const
/** 速度曲线：起飞加速段和入门减速段各占飞行进度的比例。 */
export const FLIGHT_EASE = { accel: 0.16, decel: 0.14 } as const

export type CruiseStagePlan = {
  exit: Point3
  portal: Point3
  cruiseStart: Point3
  cruiseEnd: Point3
  direction: Point3
}

export type DepartureWaypointMarks = {
  lifted: number
  /** 镜头开始从轨道位缓慢拉进追尾（接近 0 之前）。 */
  follow: number
  preGate: number
  frontGate: number
  backGate: number
  postGate: number
  cruiseStart: number
  cruiseEnd: number
  portal: number
}

function progressBetween(value: number, start: number, end: number) {
  return Math.min(1, Math.max(0, (value - start) / (end - start)))
}

export function samplePortalDeparture(elapsed: number, reducedMotion: boolean) {
  const time = Math.max(0, elapsed)
  if (reducedMotion) {
    if (time >= PORTAL_DEPARTURE_TIMING.reducedMotionComplete) {
      return { phase: 'complete' as const, progress: 1 }
    }
    return {
      phase: 'fade' as const,
      progress: progressBetween(time, 0, PORTAL_DEPARTURE_TIMING.reducedMotionComplete),
    }
  }

  let start = 0
  for (const segment of DEPARTURE_SEGMENTS) {
    const end = start + segment.duration
    if (time < end) return { phase: segment.phase, progress: progressBetween(time, start, end) }
    start = end
  }
  return { phase: 'pilot' as const, progress: 1 }
}

/** 航向角 / 俯仰角 → 单位方向向量，与 atan2(x, z) 的偏航定义一致。 */
export function headingVector(yaw: number, pitch: number): Point3 {
  const cos = Math.cos(pitch)
  return { x: Math.sin(yaw) * cos, y: Math.sin(pitch), z: Math.cos(yaw) * cos }
}

export function headingFromDirection(direction: Point3) {
  return { yaw: Math.atan2(direction.x, direction.z), pitch: Math.asin(Math.min(1, Math.max(-1, direction.y))) }
}

/**
 * 玩家驾驶一步：W 线性加速到上限，S 刹车，都松开则缓慢滑行衰减到 0；
 * Shift 加力抬高速度上限；yaw / pitch 舵量连续（俯仰有上下限）。纯函数，不做位置积分。
 */
export function stepPilot(state: PilotState, input: PilotInput, dt: number): PilotState {
  const cap = input.boost ? PILOT.boostMax : PILOT.maxSpeed
  const accel = input.boost ? PILOT.boostAccel : PILOT.accel
  const thrusting = input.thrust > 0 || (Boolean(input.boost) && input.thrust >= 0)
  let speed = state.speed
  if (input.thrust < 0) speed = Math.max(0, speed - PILOT.brake * dt)
  else if (thrusting && speed < cap) speed = Math.min(cap, speed + accel * dt)
  else if (speed > cap) speed = Math.max(cap, speed - PILOT.boostBleed * dt)
  else if (!thrusting) speed = Math.max(0, speed - PILOT.coast * dt)

  let yaw = state.yaw + Math.max(-1, Math.min(1, input.yaw)) * PILOT.yawRate * dt
  if (yaw > Math.PI) yaw -= Math.PI * 2
  if (yaw < -Math.PI) yaw += Math.PI * 2
  const pitch = Math.min(PILOT.maxPitch, Math.max(-PILOT.maxPitch, state.pitch + Math.max(-1, Math.min(1, input.pitch)) * PILOT.pitchRate * dt))
  return { speed, yaw, pitch }
}

/** Q/E 翻滚：按住按 barrelRate 连续转，松开回正到最近的 2π 水平。 */
export function stepBarrel(angle: number, input: number, dt: number) {
  if (input !== 0) return angle + Math.sign(input) * PILOT.barrelRate * dt
  const tau = Math.PI * 2
  const target = Math.round(angle / tau) * tau
  return angle + (target - angle) * (1 - Math.exp(-dt * PILOT.barrelReturn))
}

function steerCurve(value: number) {
  const magnitude = Math.abs(value)
  if (magnitude <= PILOT.steerDeadZone) return 0
  const t = Math.min(1, (magnitude - PILOT.steerDeadZone) / (PILOT.steerFullZone - PILOT.steerDeadZone))
  // 1.5 次幂：中心附近细腻，外圈满舵。
  return Math.sign(value) * Math.pow(t, 1.5)
}

/**
 * 鼠标转向：nx / ny 为指针相对画面中心的归一化偏移（右、上为正，画面边缘为 ±1）。
 * 往右推机头右转（偏航为负，因为 +yaw 是左转），往上推机头抬起。
 */
export function steerFromPointer(nx: number, ny: number) {
  const yaw = steerCurve(nx)
  return { yaw: yaw === 0 ? 0 : -yaw, pitch: steerCurve(ny) }
}

function wrapAngle(angle: number) {
  let wrapped = angle
  while (wrapped > Math.PI) wrapped -= Math.PI * 2
  while (wrapped < -Math.PI) wrapped += Math.PI * 2
  return wrapped
}

/**
 * 辅助瞄准：玩家没在打方向、门又大致在机头前方且够近时，把航向往门心收一点。
 * 越近收得越明显；有方向输入时完全不介入，玩家永远能自己开走。
 */
export function assistHeading(state: PilotState, position: Point3, portal: Point3, dt: number, steering: boolean): PilotState {
  if (steering) return state
  const dx = portal.x - position.x
  const dy = portal.y - position.y
  const dz = portal.z - position.z
  const distance = Math.hypot(dx, dy, dz)
  if (distance < 1e-6 || distance > PILOT.assistRange) return state
  const target = headingFromDirection({ x: dx / distance, y: dy / distance, z: dz / distance })
  const yawError = wrapAngle(target.yaw - state.yaw)
  const pitchError = target.pitch - state.pitch
  if (Math.hypot(yawError, pitchError) > PILOT.assistCone) return state
  // 范围边缘就有四成力度，越近越强；靠近门时目标方向变化快，力度不够会从门边擦过。
  const blend = 1 - Math.exp(-dt * PILOT.assistRate * (1 - (0.6 * distance) / PILOT.assistRange))
  return {
    speed: state.speed,
    yaw: wrapAngle(state.yaw + yawError * blend),
    pitch: Math.min(PILOT.maxPitch, Math.max(-PILOT.maxPitch, state.pitch + pitchError * blend)),
  }
}

/** 机翼尾迹保留的弧长：静止时几乎收没，全速时拖出长长的两道。 */
export function trailLengthForSpeed(speedRatio: number) {
  const ratio = Math.min(1, Math.max(0, speedRatio))
  return 0.35 + ratio * ratio * 6.5
}

/**
 * 把尾迹点列裁到给定弧长以内：从最新点向前累加距离，超出的旧点移出缓冲区。
 * positions 为 xyz 交错的连续数组，count 为当前有效点数；返回裁剪后的点数。
 */
export function trimTrailToLength(positions: Float32Array | number[], count: number, maxLength: number) {
  if (count <= 1) return count
  let kept = 1
  let travelled = 0
  for (let i = count - 1; i > 0; i -= 1) {
    const ax = positions[i * 3]!
    const ay = positions[i * 3 + 1]!
    const az = positions[i * 3 + 2]!
    const bx = positions[(i - 1) * 3]!
    const by = positions[(i - 1) * 3 + 1]!
    const bz = positions[(i - 1) * 3 + 2]!
    travelled += Math.hypot(ax - bx, ay - by, az - bz)
    if (travelled > maxLength) break
    kept += 1
  }
  if (kept < count) {
    const drop = count - kept
    if (positions instanceof Float32Array) {
      positions.copyWithin(0, drop * 3, count * 3)
    } else {
      positions.splice(0, drop * 3)
    }
  }
  return kept
}

export function sampleScanRetraction(elapsed: number) {
  const { lockEnd, beamFormed, collapseEnd } = PORTAL_DEPARTURE_TIMING
  const width = 1 - progressBetween(elapsed, lockEnd, beamFormed)
  const retract = progressBetween(elapsed, beamFormed, collapseEnd)
  const beam = elapsed < beamFormed ? 1 - width : 1 - retract
  return { width, retract, beam }
}

/**
 * 时间进度 → 弧长进度。两端抛物线加减速、中段匀速，导数处处连续，
 * 所以飞船在整条样条上不会有突然快慢。
 */
export function flightEase(t: number) {
  const { accel: a, decel: b } = FLIGHT_EASE
  const time = Math.min(1, Math.max(0, t))
  const cruiseSpeed = 1 / (1 - a / 2 - b / 2)
  if (time < a) return (cruiseSpeed * time * time) / (2 * a)
  if (time > 1 - b) return 1 - (cruiseSpeed * (1 - time) * (1 - time)) / (2 * b)
  return cruiseSpeed * (time - a / 2)
}

/** S6：以出洞点和 -z 航向为基准重新摆放传送门，并算出巡航直线两端。 */
export function planCruiseStage(zeroCenter: Point3): CruiseStagePlan {
  const exit = { ...zeroCenter, z: -ZERO_GATE_DEPTH }
  const portal = {
    x: exit.x + CRUISE_STAGE.portalOffset.x,
    y: exit.y + CRUISE_STAGE.portalOffset.y,
    z: exit.z + CRUISE_STAGE.portalOffset.z,
  }
  const turnReference = { x: exit.x, y: exit.y, z: exit.z - CRUISE_STAGE.tangent }
  const toPortal = { x: portal.x - turnReference.x, y: portal.y - turnReference.y, z: portal.z - turnReference.z }
  const length = Math.hypot(toPortal.x, toPortal.y, toPortal.z)
  const direction = { x: toPortal.x / length, y: toPortal.y / length, z: toPortal.z / length }
  const cruiseStart = {
    x: portal.x - direction.x * CRUISE_STAGE.cruiseLength,
    y: portal.y - direction.y * CRUISE_STAGE.cruiseLength,
    z: portal.z - direction.z * CRUISE_STAGE.cruiseLength,
  }
  const cruiseEnd = {
    x: portal.x - direction.x * CRUISE_STAGE.entryGap,
    y: portal.y - direction.y * CRUISE_STAGE.entryGap,
    z: portal.z - direction.z * CRUISE_STAGE.entryGap,
  }
  return { exit, portal, cruiseStart, cruiseEnd, direction }
}

/**
 * 作者空间（0 在原点、飞船大约在 10,10,2、+z 朝镜头）里的起飞形状。
 * 实际点位按当前机位相对 0 缩放，洞内 z 用真实门深，不跟缩放走。
 *
 * 走势：朝里收一点 → 外侧斜上斤斗 → 大弧落到 0 正前 → 直线穿洞 → 出洞后单调左转对准门。
 */
export const TAKEOFF_SHAPE = [
  { x: 10, y: 10, z: 2 },
  { x: 10, y: 10, z: 1.5 },
  { x: 11.2, y: 11.3, z: 1.35 },
  { x: 12.4, y: 12.5, z: 1.85 },
  { x: 12.2, y: 12.1, z: 2.35 },
  { x: 10.6, y: 9.4, z: 4.1 },
  { x: 8.1, y: 6.6, z: 7.2 },
  { x: 5.8, y: 4.6, z: 8.4 },
  { x: 3.8, y: 2.6, z: 6.8 },
  { x: 1.9, y: 1.0, z: 4.8 },
] as const

function mapTakeoffShape(start: Point3, zero: Point3): Point3[] {
  const relX = start.x - zero.x
  const relY = start.y - zero.y
  const relZ = start.z - zero.z
  const sx = relX / 10
  const sy = Math.abs(relY) < 0.45 ? Math.sign(relY || 1) * 0.45 : relY / 10
  const sz = Math.max(0.45, relZ / 2)
  const floor = ZERO_GATE_DEPTH + 0.45
  const originZ = TAKEOFF_SHAPE[0]!.z
  return TAKEOFF_SHAPE.map((point, index) => {
    if (index === 0) return { ...start }
    return {
      x: zero.x + point.x * sx,
      y: zero.y + point.y * sy,
      z: Math.max(floor, start.z + (point.z - originZ) * sz),
    }
  })
}

/**
 * 整条起飞航路。过场样条只到接手点，门心不进样条，避免末端被远处的点拽歪、左右摆。
 */
export function buildDepartureWaypoints(
  start: Point3,
  zeroCenter: Point3,
  plan: CruiseStagePlan = planCruiseStage(zeroCenter),
  _aim: Point3 = { x: 0, y: 0, z: SCAN_IMPACT_Z },
): { points: Point3[]; marks: DepartureWaypointMarks; align: AlignTurnPath } {
  const approach = mapTakeoffShape(start, zeroCenter)
  const preGate = { ...zeroCenter, z: ZERO_GATE_DEPTH + 1.5 }
  const gates: Point3[] = [
    preGate,
    { ...zeroCenter, z: ZERO_GATE_DEPTH },
    { ...zeroCenter },
    { ...zeroCenter, z: -ZERO_GATE_DEPTH },
    { ...zeroCenter, z: -ZERO_GATE_DEPTH - 2 },
  ]
  const postGate = gates[gates.length - 1]!
  // 出洞后按航向积分左转，转完沿门心方向锁死；接手点就是这段的终点。
  const align = buildAlignTurn(postGate, { x: 0, y: 0, z: -1 }, plan.direction)
  plan.cruiseStart = { ...align.end }
  const points: Point3[] = [...approach, ...gates, ...align.points.slice(1)]

  const preGateIndex = approach.length
  const marks: DepartureWaypointMarks = {
    lifted: 1,
    follow: 9,
    preGate: preGateIndex,
    frontGate: preGateIndex + 1,
    backGate: preGateIndex + 3,
    postGate: preGateIndex + 4,
    cruiseStart: points.length - 1,
    cruiseEnd: points.length - 1,
    portal: points.length - 1,
  }
  return { points, marks, align }
}
