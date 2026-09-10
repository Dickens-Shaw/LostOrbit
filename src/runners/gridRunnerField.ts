/**
 * 背景网格巡航船：沿 32px 网格线飞行，只在交叉点转向，永不出界，带定长拖尾。
 * 这里是纯逻辑（网格坐标），渲染在 GridRunners.tsx。
 */

export type GridRunnerOptions = {
  /** 飞船数量 */
  count: number
  /** 拖尾长度（格） */
  trailCells: number
  /** 速度（格/秒），每艘会在 ±25% 内随机 */
  speed: number
  /** 到交叉点时转向的概率 */
  turnChance: number
  /** 随机源，测试时可注入 */
  random?: () => number
}

/** 404 起飞动画期间加在 body 上的标记：背景层收起巡航小船和鼠标光晕，只留星星做太空背景。 */
export const DEPARTING_BODY_CLASS = 'absent-departing'

export const GRID_RUNNER_DEFAULTS: GridRunnerOptions = {
  count: 4,
  trailCells: 14,
  speed: 2.2,
  turnChance: 0.35,
}

/** 0 右 1 下 2 左 3 上 */
export type Dir = 0 | 1 | 2 | 3
export const DIR_DX = [1, 0, -1, 0] as const
export const DIR_DY = [0, 1, 0, -1] as const

export type GridPoint = { x: number; y: number }

export type Runner = {
  /** 当前所在（或刚离开）的交叉点 */
  cx: number
  cy: number
  dir: Dir
  /** 到下一交叉点的进度 0..1 */
  progress: number
  speed: number
  /** 走过的交叉点，新的在后 */
  path: GridPoint[]
  /** 呼吸相位，渲染用 */
  phase: number
}

export type RunnerBounds = { cols: number; rows: number }

const MARGIN = 1

function inBounds(x: number, y: number, bounds: RunnerBounds): boolean {
  return x >= MARGIN && x <= bounds.cols - MARGIN && y >= MARGIN && y <= bounds.rows - MARGIN
}

function pickDir(runner: Runner, bounds: RunnerBounds, turnChance: number, random: () => number): Dir {
  const reverse = ((runner.dir + 2) % 4) as Dir
  const valid = ([0, 1, 2, 3] as Dir[]).filter(
    (dir) => dir !== reverse && inBounds(runner.cx + DIR_DX[dir], runner.cy + DIR_DY[dir], bounds),
  )
  if (valid.length === 0) return reverse
  const straightOk = valid.includes(runner.dir)
  const turns = valid.filter((dir) => dir !== runner.dir)
  if (straightOk && (turns.length === 0 || random() >= turnChance)) return runner.dir
  return turns[Math.floor(random() * turns.length)] ?? runner.dir
}

export function spawnRunner(bounds: RunnerBounds, options: GridRunnerOptions, random: () => number): Runner {
  const cx = MARGIN + Math.floor(random() * Math.max(1, bounds.cols - MARGIN * 2 + 1))
  const cy = MARGIN + Math.floor(random() * Math.max(1, bounds.rows - MARGIN * 2 + 1))
  const runner: Runner = {
    cx,
    cy,
    dir: Math.floor(random() * 4) as Dir,
    progress: 0,
    speed: options.speed * (0.75 + random() * 0.5),
    path: [{ x: cx, y: cy }],
    phase: random() * Math.PI * 2,
  }
  runner.dir = pickDir(runner, bounds, 1, random)
  return runner
}

export function stepRunner(runner: Runner, dt: number, bounds: RunnerBounds, options: GridRunnerOptions, random: () => number) {
  runner.progress += runner.speed * dt
  // 一帧可能跨过多个交叉点（切后台回来的大 dt），逐点处理保证每一步都在网格线上。
  let guard = 0
  while (runner.progress >= 1 && guard < 64) {
    runner.progress -= 1
    runner.cx += DIR_DX[runner.dir]
    runner.cy += DIR_DY[runner.dir]
    runner.path.push({ x: runner.cx, y: runner.cy })
    if (runner.path.length > options.trailCells + 2) runner.path.splice(0, runner.path.length - (options.trailCells + 2))
    runner.dir = pickDir(runner, bounds, options.turnChance, random)
    guard += 1
  }
}

/** 头部的精确网格坐标（可能在两交叉点之间）。 */
export function runnerHead(runner: Runner): GridPoint {
  return {
    x: runner.cx + DIR_DX[runner.dir] * runner.progress,
    y: runner.cy + DIR_DY[runner.dir] * runner.progress,
  }
}

/** 视口尺寸变化后把船拉回界内，并丢掉出界的拖尾。 */
export function clampRunner(runner: Runner, bounds: RunnerBounds, random: () => number) {
  if (inBounds(runner.cx, runner.cy, bounds) && inBounds(runner.cx + DIR_DX[runner.dir], runner.cy + DIR_DY[runner.dir], bounds)) {
    runner.path = runner.path.filter((point) => inBounds(point.x, point.y, bounds))
    if (runner.path.length === 0) runner.path.push({ x: runner.cx, y: runner.cy })
    return
  }
  runner.cx = Math.min(Math.max(runner.cx, MARGIN), Math.max(MARGIN, bounds.cols - MARGIN))
  runner.cy = Math.min(Math.max(runner.cy, MARGIN), Math.max(MARGIN, bounds.rows - MARGIN))
  runner.progress = 0
  runner.path = [{ x: runner.cx, y: runner.cy }]
  runner.dir = pickDir(runner, bounds, 1, random)
}

export type RunnerField = {
  runners: Runner[]
  bounds: RunnerBounds
  options: GridRunnerOptions
  step: (dt: number) => void
  resize: (bounds: RunnerBounds) => void
}

export function createRunnerField(bounds: RunnerBounds, partial: Partial<GridRunnerOptions> = {}): RunnerField {
  const options: GridRunnerOptions = { ...GRID_RUNNER_DEFAULTS, ...partial }
  const random = options.random ?? Math.random
  const field: RunnerField = {
    runners: [],
    bounds,
    options,
    step(dt) {
      for (const runner of field.runners) stepRunner(runner, dt, field.bounds, options, random)
    },
    resize(next) {
      field.bounds = next
      for (const runner of field.runners) clampRunner(runner, next, random)
    },
  }
  const usable = bounds.cols > MARGIN * 2 && bounds.rows > MARGIN * 2
  if (usable) field.runners = Array.from({ length: Math.max(0, Math.floor(options.count)) }, () => spawnRunner(bounds, options, random))
  return field
}

/**
 * 从头往尾把折线切成定长（trailCells 格），返回从头到尾的点列，最后一点是精确截断位置。
 * 渲染时按顺序衰减透明度即可得到渐变拖尾。
 */
export function trailPoints(runner: Runner, trailCells: number): GridPoint[] {
  const points: GridPoint[] = [runnerHead(runner)]
  let remaining = trailCells
  for (let i = runner.path.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const prev = points[points.length - 1]!
    const next = runner.path[i]!
    const seg = Math.abs(next.x - prev.x) + Math.abs(next.y - prev.y)
    if (seg === 0) continue
    if (seg <= remaining) {
      points.push({ x: next.x, y: next.y })
      remaining -= seg
    } else {
      const t = remaining / seg
      points.push({ x: prev.x + (next.x - prev.x) * t, y: prev.y + (next.y - prev.y) * t })
      remaining = 0
    }
  }
  return points
}

export const GRID_STAR_COUNT = 120

export type GridStar = {
  /** 视口归一化坐标，resize 时不用重生。 */
  u: number
  v: number
  size: number
  phase: number
  twinkle: number
}

export function createStars(count: number, random: () => number = Math.random): GridStar[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, () => ({
    u: random(),
    v: random(),
    size: 0.6 + random() * 1.4,
    phase: random() * Math.PI * 2,
    twinkle: 0.6 + random() * 1.4,
  }))
}

/** 鼠标高亮半径（像素）。只画这个圆里的方格边，避免全屏描线。 */
export const GRID_GLOW_RADIUS = 120

/** 距高亮中心 `d` 处的强度，二次衰减，圆外为 0。 */
export function gridGlowAt(dx: number, dy: number, radius = GRID_GLOW_RADIUS): number {
  const distance = Math.hypot(dx, dy)
  if (distance >= radius) return 0
  const t = 1 - distance / radius
  return t * t
}
