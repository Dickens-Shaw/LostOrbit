import { describe, expect, test } from 'vitest'
import {
  assistHeading,
  CRUISE_STAGE,
  DEPARTURE_SEGMENTS,
  PILOT,
  SCAN_IMPACT_Z,
  ZERO_GATE_DEPTH,
  scanFanBase,
  takeoffHeading,
  alignTurnPoints,
  buildAlignTurn,
  buildDepartureWaypoints,
  flightEase,
  headingFromDirection,
  headingVector,
  planCruiseStage,
  samplePortalDeparture,
  sampleScanRetraction,
  steerFromPointer,
  stepBarrel,
  stepPilot,
  trailLengthForSpeed,
  trimTrailToLength,
} from '../portalDeparture'

const start = { x: 6, y: 5, z: 3 }
const zeroCenter = { x: -0.24, y: 0, z: 0 }

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

describe('传送门起飞状态机', () => {
  test('锁定 → 收束 → 一段过场飞行 → 交给玩家驾驶，不再按时间结束', () => {
    let at = 0
    for (const segment of DEPARTURE_SEGMENTS) {
      expect(samplePortalDeparture(at + segment.duration / 2, false).phase).toBe(segment.phase)
      at += segment.duration
    }
    expect(samplePortalDeparture(at, false).phase).toBe('pilot')
    expect(samplePortalDeparture(at + 600, false).phase).toBe('pilot')
  })

  test('减少动态效果在 200ms 淡出后完成', () => {
    expect(samplePortalDeparture(0.1, true)).toMatchObject({ phase: 'fade', progress: 0.5 })
    expect(samplePortalDeparture(0.2, true).phase).toBe('complete')
  })

  test('扫描三角先收窄成一束，再缩回发射点', () => {
    expect(sampleScanRetraction(0)).toEqual({ width: 1, retract: 0, beam: 0 })
    expect(sampleScanRetraction(0.7)).toMatchObject({ width: 0, retract: 0, beam: 1 })
    expect(sampleScanRetraction(1.15)).toEqual({ width: 0, retract: 1, beam: 0 })
  })

  test('光幕底边就是扫描底光两端，收回时沿机头方向缩回', () => {
    const emitter = { x: 6, y: 5, z: 3 }
    const impact = { x: 0, y: 1, z: SCAN_IMPACT_Z }
    const fan = scanFanBase(emitter, impact, 1, 0, 2)
    expect(fan.end).toEqual(impact)
    expect(fan.left).toEqual({ x: -2, y: 1, z: SCAN_IMPACT_Z })
    expect(fan.right).toEqual({ x: 2, y: 1, z: SCAN_IMPACT_Z })
    const retracted = scanFanBase(emitter, impact, 0, 1, 2)
    expect(retracted.end).toEqual(emitter)
    expect(retracted.left).toEqual(emitter)
    expect(retracted.right).toEqual(emitter)
  })
})

describe('飞行速度曲线', () => {
  test('两端为零速、中段匀速、全程单调且导数连续', () => {
    expect(flightEase(0)).toBe(0)
    expect(flightEase(1)).toBeCloseTo(1)
    let prev = 0
    let prevSlope = 0
    const h = 0.001
    for (let t = h; t <= 1; t += h) {
      const u = flightEase(t)
      expect(u).toBeGreaterThanOrEqual(prev)
      const slope = (u - prev) / h
      if (t > 2 * h) expect(Math.abs(slope - prevSlope)).toBeLessThan(0.05)
      prev = u
      prevSlope = slope
    }
  })
})

describe('玩家驾驶', () => {
  const rest = { speed: 0, yaw: 0, pitch: 0 }
  const idle = { thrust: 0, yaw: 0, pitch: 0 }

  test('长按 W 加速到上限后不再增加；松开缓慢滑行衰减；S 刹车更快', () => {
    let state = rest
    for (let i = 0; i < 600; i += 1) state = stepPilot(state, { ...idle, thrust: 1 }, 1 / 60)
    expect(state.speed).toBe(PILOT.maxSpeed)
    expect(stepPilot(rest, { ...idle, thrust: 1 }, 0.5).speed).toBeCloseTo(PILOT.accel * 0.5)
    const full = { ...rest, speed: PILOT.maxSpeed }
    const coasted = stepPilot(full, idle, 0.5).speed
    const braked = stepPilot(full, { ...idle, thrust: -1 }, 0.5).speed
    expect(coasted).toBeCloseTo(PILOT.maxSpeed - PILOT.coast * 0.5)
    expect(braked).toBeLessThan(coasted)
    for (let i = 0; i < 600; i += 1) state = stepPilot(state, idle, 1 / 60)
    expect(state.speed).toBe(0)
  })

  test('鼠标转向：中心死区直飞，往右推右转、往上推抬头，边缘满舵', () => {
    expect(steerFromPointer(0.03, -0.03)).toEqual({ yaw: 0, pitch: 0 })
    const right = steerFromPointer(0.3, 0)
    expect(right.yaw).toBeLessThan(0)
    expect(right.pitch).toBe(0)
    expect(steerFromPointer(0.9, 0).yaw).toBe(-1)
    expect(steerFromPointer(0, 0.9).pitch).toBe(1)
    expect(Math.abs(steerFromPointer(0.15, 0).yaw)).toBeLessThan(Math.abs(steerFromPointer(0.4, 0).yaw))
  })

  test('Shift 加力超过巡航上限；松开后掉回巡航速度；S 仍能刹住', () => {
    let state = rest
    for (let i = 0; i < 600; i += 1) state = stepPilot(state, { ...idle, boost: true }, 1 / 60)
    expect(state.speed).toBe(PILOT.boostMax)
    expect(state.speed).toBeGreaterThan(PILOT.maxSpeed)
    const cruise = stepPilot({ ...rest, speed: PILOT.boostMax }, idle, 0.5)
    expect(cruise.speed).toBeCloseTo(PILOT.boostMax - PILOT.boostBleed * 0.5)
    expect(cruise.speed).toBeGreaterThan(PILOT.maxSpeed)
    const braked = stepPilot({ ...rest, speed: PILOT.boostMax }, { ...idle, thrust: -1, boost: true }, 0.5)
    expect(braked.speed).toBeLessThan(PILOT.boostMax - PILOT.brake * 0.4)
  })

  test('Q/E 翻滚按住连续转，松开回正到最近水平', () => {
    const rolled = stepBarrel(0, 1, 0.5)
    expect(rolled).toBeCloseTo(PILOT.barrelRate * 0.5)
    expect(stepBarrel(0.2, 0, 2)).toBeCloseTo(0)
    expect(stepBarrel(Math.PI * 2 - 0.2, 0, 2)).toBeCloseTo(Math.PI * 2)
  })

  test('舵量连续：半舵转得比满舵慢，偏航绕回 ±π，俯仰有上下限', () => {
    expect(stepPilot(rest, { ...idle, yaw: 0.5 }, 1).yaw).toBeCloseTo(PILOT.yawRate * 0.5)
    const left = stepPilot(rest, { ...idle, yaw: 1 }, 1)
    expect(left.yaw).toBeCloseTo(PILOT.yawRate)
    const wrapped = stepPilot({ ...rest, yaw: Math.PI - 0.1 }, { ...idle, yaw: 1 }, 1)
    expect(wrapped.yaw).toBeLessThan(0)
    let state = rest
    for (let i = 0; i < 300; i += 1) state = stepPilot(state, { ...idle, pitch: 1 }, 1 / 30)
    expect(state.pitch).toBe(PILOT.maxPitch)
    for (let i = 0; i < 600; i += 1) state = stepPilot(state, { ...idle, pitch: -1 }, 1 / 30)
    expect(state.pitch).toBe(-PILOT.maxPitch)
  })

  test('辅助瞄准只在松开方向键、门在机头前且够近时把航向往门心收', () => {
    const portal = { x: 0, y: 0, z: 10 }
    const near = { x: 0.8, y: 0, z: 6 } // 门在机头前方略偏一侧，距离 4
    const state = { speed: 3, yaw: 0, pitch: 0 }
    const assisted = assistHeading(state, near, portal, 0.5, false)
    const targetYaw = Math.atan2(portal.x - near.x, portal.z - near.z)
    expect(assisted.yaw).toBeLessThan(0)
    expect(assisted.yaw).toBeGreaterThan(targetYaw)
    expect(assisted.speed).toBe(3)
    // 玩家在打方向：不介入
    expect(assistHeading(state, near, portal, 0.5, true)).toEqual(state)
    // 太远：不介入
    expect(assistHeading(state, { x: 0.8, y: 0, z: 10 - PILOT.assistRange - 5 }, portal, 0.5, false)).toEqual(state)
    // 门在侧后方（超出锥角）：不介入
    expect(assistHeading({ ...state, yaw: Math.PI }, near, portal, 0.5, false)).toEqual({ ...state, yaw: Math.PI })
  })

  test('航向角 ↔ 方向向量互逆', () => {
    const direction = headingVector(0.7, -0.3)
    expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1)
    const heading = headingFromDirection(direction)
    expect(heading.yaw).toBeCloseTo(0.7)
    expect(heading.pitch).toBeCloseTo(-0.3)
  })
})

describe('速度驱动的尾焰与尾迹', () => {
  test('尾迹长度和马赫环随速度单调增长，静止时几乎熄灭', () => {
    expect(trailLengthForSpeed(0)).toBeLessThan(0.5)
    expect(trailLengthForSpeed(1)).toBeGreaterThan(6)
    expect(trailLengthForSpeed(0.5)).toBeGreaterThan(trailLengthForSpeed(0.25))
  })

  test('尾迹按弧长裁剪，旧点移出缓冲区、最新点保留', () => {
    // 5 个点沿 x 轴每隔 1 单位
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0])
    const kept = trimTrailToLength(positions, 5, 2.5)
    expect(kept).toBe(3)
    expect(Array.from(positions.slice(0, kept * 3))).toEqual([2, 0, 0, 3, 0, 0, 4, 0, 0])
    expect(trimTrailToLength(positions, kept, 100)).toBe(3)
    expect(trimTrailToLength(positions, 1, 0)).toBe(1)
  })
})

describe('起飞航路点', () => {
  const plan = planCruiseStage(zeroCenter)
  const { points, marks } = buildDepartureWaypoints(start, zeroCenter, plan)

  test('朝里飞、外侧斜上斤斗、再大弧穿 0', () => {
    expect(points[0]).toEqual(start)
    expect(points[marks.lifted]!.z).toBeLessThan(start.z)
    const loop = points.slice(marks.lifted + 1, marks.follow)
    expect(Math.max(...loop.map((p) => p.y))).toBeGreaterThan(start.y + 0.4)
    expect(Math.max(...loop.map((p) => Math.abs(p.x - zeroCenter.x)))).toBeGreaterThan(Math.abs(start.x - zeroCenter.x) + 0.3)
    for (let i = marks.preGate; i <= marks.postGate; i += 1) {
      expect(points[i]!.x).toBeCloseTo(zeroCenter.x)
      expect(points[i]!.y).toBeCloseTo(zeroCenter.y)
    }
    expect(points[marks.frontGate]!.z).toBe(ZERO_GATE_DEPTH)
    expect(points[marks.backGate]!.z).toBe(-ZERO_GATE_DEPTH)
    for (let i = 0; i < marks.frontGate; i += 1) expect(points[i]!.z).toBeGreaterThan(ZERO_GATE_DEPTH)
  })

  test('出洞后单调对准传送门，样条停在接手点', () => {
    expect(distance(plan.exit, plan.portal)).toBeGreaterThan(25)
    expect(plan.direction.x).toBeLessThan(0)
    expect(points[marks.cruiseStart]).toEqual(plan.cruiseStart)
    expect(points[points.length - 1]).toEqual(plan.cruiseStart)
    expect(distance(plan.cruiseStart, plan.portal)).toBeGreaterThanOrEqual(100)
    expect(PILOT.leash).toBeGreaterThan(distance(plan.cruiseStart, plan.portal) + 10)
    const turn = alignTurnPoints(plan.exit, { x: 0, y: 0, z: -1 }, plan.cruiseStart, plan.direction)
    for (let i = 1; i < turn.length; i += 1) expect(turn[i]!.x).toBeLessThanOrEqual(turn[i - 1]!.x + 1e-6)
    const lead = points[marks.cruiseStart - 1]!
    const toStart = { x: plan.cruiseStart.x - lead.x, y: plan.cruiseStart.y - lead.y, z: plan.cruiseStart.z - lead.z }
    const length = Math.hypot(toStart.x, toStart.y, toStart.z)
    expect(length).toBeGreaterThan(0.5)
    expect(toStart.x / length).toBeCloseTo(plan.direction.x, 2)
    expect(toStart.z / length).toBeCloseTo(plan.direction.z, 2)
    const heading = Math.atan2(-plan.direction.x, -plan.direction.z)
    expect(heading).toBeGreaterThan(Math.PI / 6)
    expect(heading).toBeLessThan((Math.PI * 5) / 18)
  })

  test('出洞对准：航向只朝门转、半程已转过大半，转完锁死不再左右摆', () => {
    const path = buildAlignTurn(plan.exit, { x: 0, y: 0, z: -1 }, plan.direction)
    const startYaw = headingFromDirection(path.sample(0).tangent).yaw
    const endYaw = headingFromDirection(plan.direction).yaw
    const span = ((endYaw - startYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI
    expect(span).toBeGreaterThan(0.3)
    const startDot = path.sample(0).tangent
    expect(startDot.z).toBeLessThan(-0.98)
    const locked = path.sample(path.turnLength)
    expect(locked.tangent.x).toBeCloseTo(plan.direction.x, 2)
    expect(locked.tangent.z).toBeCloseTo(plan.direction.z, 2)
    const mid = headingFromDirection(path.sample(path.turnLength * 0.45).tangent).yaw
    const midSpan = ((mid - startYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI
    expect(midSpan / span).toBeGreaterThan(0.55)
    let prev = startYaw
    for (let d = 0.25; d <= path.length; d += 0.25) {
      const yaw = headingFromDirection(path.sample(d).tangent).yaw
      let step = yaw - prev
      if (step > Math.PI) step -= Math.PI * 2
      if (step < -Math.PI) step += Math.PI * 2
      expect(step).toBeGreaterThanOrEqual(-1e-3)
      prev = yaw
    }
    const after = path.sample(path.length)
    expect(after.point).toEqual(path.end)
    expect(after.tangent.x).toBeCloseTo(plan.direction.x, 2)
    expect(after.tangent.z).toBeCloseTo(plan.direction.z, 2)
  })

  test('航路点顺序：跟随后于斤斗、先于进洞，接手在最后', () => {
    const order = [marks.lifted, marks.follow, marks.preGate, marks.frontGate, marks.backGate, marks.postGate, marks.cruiseStart]
    for (let i = 1; i < order.length; i += 1) expect(order[i]).toBeGreaterThan(order[i - 1]!)
  })
})
