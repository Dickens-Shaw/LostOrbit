import {
  createRunnerField,
  createStars,
  DEPARTING_BODY_CLASS,
  DIR_DX,
  DIR_DY,
  GRID_GLOW_RADIUS,
  GRID_RUNNER_DEFAULTS,
  GRID_STAR_COUNT,
  gridGlowAt,
  runnerHead,
  trailPoints,
} from './gridRunnerField'

/** 与样式里 body 网格 background-size 保持一致。 */
export const GRID_CELL = 32

export type GridRunnersMountOptions = {
  count?: number
  trailCells?: number
  speed?: number
  turnChance?: number
  starCount?: number
  reducedMotion?: boolean
}

type Rgb = [number, number, number]

function readRgb(ctx: CanvasRenderingContext2D, name: string, fallback: Rgb): Rgb {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!raw) return fallback
  ctx.fillStyle = raw
  const normalized = String(ctx.fillStyle)
  const hex = /^#([0-9a-f]{6})$/i.exec(normalized)
  if (hex) {
    const value = parseInt(hex[1]!, 16)
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
  }
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(normalized)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return fallback
}

function toWorld(hx: number, hy: number, dx: number, dy: number, forward: number, side: number) {
  return [hx + forward * dx - side * dy, hy + forward * dy + side * dx] as const
}

function drawScout(
  ctx: CanvasRenderingContext2D,
  hx: number,
  hy: number,
  dx: number,
  dy: number,
  hull: string,
  trim: string,
  glow: string,
) {
  const p = (forward: number, side: number) => toWorld(hx, hy, dx, dy, forward, side)
  const poly = (points: Array<readonly [number, number]>, fill: string) => {
    const first = points[0]
    if (!first) return
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.moveTo(first[0], first[1])
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i]![0], points[i]![1])
    ctx.closePath()
    ctx.fill()
  }

  poly([p(-5.2, 0), p(-3.4, 3.4), p(-0.6, 3.6), p(-1.8, 1.1)], hull)
  poly([p(-5.2, 0), p(-3.4, -3.4), p(-0.6, -3.6), p(-1.8, -1.1)], hull)
  poly([p(-5.4, 1.15), p(3.2, 1.15), p(5.8, 0), p(3.2, -1.15), p(-5.4, -1.15)], hull)
  poly([p(3.2, 0.7), p(6.4, 0), p(3.2, -0.7)], trim)
  poly([p(-0.2, 0.7), p(2.1, 0.55), p(2.1, -0.55), p(-0.2, -0.7)], trim)
  poly([p(-5.8, 0.7), p(-4.4, 0.7), p(-4.4, -0.7), p(-5.8, -0.7)], trim)
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(...p(-6.2, 0), 1.35, 0, Math.PI * 2)
  ctx.fill()
}

function maskAt(x: number, y: number, width: number, height: number): number {
  const nx = (x - width / 2) / (width / 2)
  const ny = y / height
  const d = Math.sqrt(nx * nx + ny * ny) / Math.SQRT2
  const t = Math.min(Math.max((d - 0.3) / 0.45, 0), 1)
  return 1 - t * t * (3 - 2 * t)
}

function drawGridGlow(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  width: number,
  height: number,
  accent: Rgb,
  core: Rgb,
  alpha: number,
) {
  const [ar, ag, ab] = accent
  const [cr, cg, cb] = core
  const radius = GRID_GLOW_RADIUS
  const wash = ctx.createRadialGradient(gx, gy, 0, gx, gy, radius)
  wash.addColorStop(0, `rgba(${ar},${ag},${ab},${(0.16 * alpha * maskAt(gx, gy, width, height)).toFixed(3)})`)
  wash.addColorStop(0.45, `rgba(${ar},${ag},${ab},${(0.05 * alpha * maskAt(gx, gy, width, height)).toFixed(3)})`)
  wash.addColorStop(1, `rgba(${ar},${ag},${ab},0)`)
  ctx.fillStyle = wash
  ctx.beginPath()
  ctx.arc(gx, gy, radius, 0, Math.PI * 2)
  ctx.fill()

  const col0 = Math.max(0, Math.floor((gx - radius) / GRID_CELL))
  const col1 = Math.ceil((gx + radius) / GRID_CELL)
  const row0 = Math.max(0, Math.floor((gy - radius) / GRID_CELL))
  const row1 = Math.ceil((gy + radius) / GRID_CELL)
  ctx.lineCap = 'round'

  const strokeSeg = (x1: number, y1: number, x2: number, y2: number) => {
    const mx = (x1 + x2) / 2
    const my = (y1 + y2) / 2
    const energy = gridGlowAt(mx - gx, my - gy) * maskAt(mx, my, width, height) * alpha
    if (energy < 0.02) return
    ctx.strokeStyle = `rgba(${ar},${ag},${ab},${(energy * 0.38).toFixed(3)})`
    ctx.lineWidth = 5.5
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(energy * 0.9).toFixed(3)})`
    ctx.lineWidth = 1.15
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  for (let row = row0; row <= row1; row += 1) {
    const y = row * GRID_CELL
    for (let col = col0; col < col1; col += 1) strokeSeg(col * GRID_CELL, y, (col + 1) * GRID_CELL, y)
  }
  for (let col = col0; col <= col1; col += 1) {
    const x = col * GRID_CELL
    for (let row = row0; row < row1; row += 1) strokeSeg(x, row * GRID_CELL, x, (row + 1) * GRID_CELL)
  }

  for (let row = row0; row <= row1; row += 1) {
    for (let col = col0; col <= col1; col += 1) {
      const x = col * GRID_CELL
      const y = row * GRID_CELL
      const energy = gridGlowAt(x - gx, y - gy) * maskAt(x, y, width, height) * alpha
      if (energy < 0.12) continue
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${(energy * 0.85).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(x, y, 1.1 + energy * 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/**
 * 把巡航小船背景画到 host 里的 canvas。返回拆除函数。
 * 起飞时场景会给 body 加上 DEPARTING_BODY_CLASS，小船和光晕会淡出。
 */
export function mountGridRunners(host: HTMLElement, options: GridRunnersMountOptions = {}): () => void {
  const count = options.count ?? GRID_RUNNER_DEFAULTS.count
  const trailCells = options.trailCells ?? GRID_RUNNER_DEFAULTS.trailCells
  const speed = options.speed ?? GRID_RUNNER_DEFAULTS.speed
  const turnChance = options.turnChance ?? GRID_RUNNER_DEFAULTS.turnChance
  const starCount = options.starCount ?? GRID_STAR_COUNT
  const reducedMotion =
    options.reducedMotion ??
    (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  const canvas = document.createElement('canvas')
  canvas.className = 'grid-runners'
  canvas.setAttribute('aria-hidden', 'true')
  host.append(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => canvas.remove()

  let width = 0
  let height = 0
  let accent: Rgb = [200, 169, 107]
  let core: Rgb = [239, 230, 207]
  let mute: Rgb = [154, 152, 144]
  const bounds = () => ({ cols: Math.floor(width / GRID_CELL), rows: Math.floor(height / GRID_CELL) })

  const fit = () => {
    width = window.innerWidth
    height = window.innerHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  const paint = () => {
    accent = readRgb(ctx, '--lp-accent', accent)
    core = readRgb(ctx, '--lp-sheen', core)
    mute = readRgb(ctx, '--lp-mute', mute)
  }

  fit()
  paint()
  const field = createRunnerField(bounds(), { count, trailCells, speed, turnChance })
  const stars = createStars(starCount)
  let pointerX = Number.NaN
  let pointerY = Number.NaN
  let glowX = Number.NaN
  let glowY = Number.NaN
  let runnerAlpha = 1
  let last = performance.now()
  let frame = 0

  const draw = (now: number, animate: boolean) => {
    const departing = document.body.classList.contains(DEPARTING_BODY_CLASS)
    if (animate) {
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      field.step(dt)
      runnerAlpha += ((departing ? 0 : 1) - runnerAlpha) * (1 - Math.exp(-dt * 3))
      if (runnerAlpha < 0.005) runnerAlpha = 0
      if (Number.isFinite(pointerX)) {
        if (!Number.isFinite(glowX)) {
          glowX = pointerX
          glowY = pointerY
        } else {
          const follow = 1 - Math.exp(-dt * 8)
          glowX += (pointerX - glowX) * follow
          glowY += (pointerY - glowY) * follow
        }
      }
    }

    ctx.clearRect(0, 0, width, height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const [ar, ag, ab] = accent
    const [cr, cg, cb] = core
    const [mr, mg, mb] = mute

    for (const star of stars) {
      const sx = star.u * width
      const sy = star.v * height
      const mask = maskAt(sx, sy, width, height)
      if (mask <= 0.02) continue
      const pulse = reducedMotion ? 0.55 : 0.35 + (Math.sin((now / 1000) * star.twinkle + star.phase) * 0.5 + 0.5) * 0.65
      ctx.fillStyle = `rgba(${mr},${mg},${mb},${(pulse * mask * 0.7).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(sx, sy, star.size, 0, Math.PI * 2)
      ctx.fill()
    }

    if (!animate && departing) runnerAlpha = 0
    if (Number.isFinite(glowX) && runnerAlpha > 0) drawGridGlow(ctx, glowX, glowY, width, height, accent, core, runnerAlpha)
    if (!animate) return
    if (runnerAlpha <= 0) {
      frame = requestAnimationFrame((time) => draw(time, true))
      return
    }

    ctx.globalAlpha = runnerAlpha
    for (const runner of field.runners) {
      const points = trailPoints(runner, trailCells)
      let travelled = 0
      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i]!
        const b = points[i + 1]!
        const seg = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
        const ax = a.x * GRID_CELL
        const ay = a.y * GRID_CELL
        const bx = b.x * GRID_CELL
        const by = b.y * GRID_CELL
        const gradient = ctx.createLinearGradient(ax, ay, bx, by)
        const fadeA = Math.pow(1 - travelled / trailCells, 1.6)
        const fadeB = Math.pow(1 - Math.min(1, (travelled + seg) / trailCells), 1.6)
        const maskA = maskAt(ax, ay, width, height)
        const maskB = maskAt(bx, by, width, height)
        gradient.addColorStop(0, `rgba(${ar},${ag},${ab},${(fadeA * maskA * 0.85).toFixed(3)})`)
        gradient.addColorStop(1, `rgba(${ar},${ag},${ab},${(fadeB * maskB * 0.85).toFixed(3)})`)
        ctx.strokeStyle = gradient
        ctx.lineWidth = 1.5 + fadeA * 1.2
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
        travelled += seg
      }

      const head = runnerHead(runner)
      const hx = head.x * GRID_CELL
      const hy = head.y * GRID_CELL
      const mask = maskAt(hx, hy, width, height)
      if (mask <= 0.02) continue
      const dx = DIR_DX[runner.dir]
      const dy = DIR_DY[runner.dir]
      const pulse = 0.7 + Math.sin((now / 1000) * 3 + runner.phase) * 0.3
      const bloom = ctx.createRadialGradient(hx, hy, 0, hx, hy, 11)
      bloom.addColorStop(0, `rgba(${cr},${cg},${cb},${(0.28 * pulse * mask).toFixed(3)})`)
      bloom.addColorStop(1, `rgba(${ar},${ag},${ab},0)`)
      ctx.fillStyle = bloom
      ctx.beginPath()
      ctx.arc(hx, hy, 11, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = mask * runnerAlpha
      drawScout(
        ctx,
        hx,
        hy,
        dx,
        dy,
        `rgba(${mr},${mg},${mb},${0.92})`,
        `rgba(${ar},${ag},${ab},${0.95})`,
        `rgba(${cr},${cg},${cb},${(0.75 + pulse * 0.25).toFixed(3)})`,
      )
      ctx.globalAlpha = runnerAlpha
    }
    ctx.globalAlpha = 1
    frame = requestAnimationFrame((time) => draw(time, true))
  }

  const onPointerMove = (event: PointerEvent) => {
    pointerX = event.clientX
    pointerY = event.clientY
    if (reducedMotion) {
      glowX = pointerX
      glowY = pointerY
      draw(performance.now(), false)
    }
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  const onResize = () => {
    fit()
    field.resize(bounds())
    if (reducedMotion) draw(performance.now(), false)
  }
  window.addEventListener('resize', onResize)
  const themeObserver = new MutationObserver(() => {
    paint()
    if (reducedMotion) draw(performance.now(), false)
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

  if (reducedMotion) draw(performance.now(), false)
  else frame = requestAnimationFrame((time) => draw(time, true))

  return () => {
    cancelAnimationFrame(frame)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('resize', onResize)
    themeObserver.disconnect()
    canvas.remove()
  }
}
