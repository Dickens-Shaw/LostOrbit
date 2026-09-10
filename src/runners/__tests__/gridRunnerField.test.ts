import { expect, test } from 'vitest'
import { createRunnerField, createStars, DIR_DX, DIR_DY, GRID_STAR_COUNT, gridGlowAt, runnerHead, trailPoints } from '../gridRunnerField'

function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

test('巡航船永远贴着网格线，且不会飞出视口', () => {
  const bounds = { cols: 20, rows: 12 }
  const field = createRunnerField(bounds, { count: 6, trailCells: 10, speed: 8, random: seeded(7) })
  expect(field.runners).toHaveLength(6)

  for (let i = 0; i < 2000; i += 1) {
    field.step(1 / 60)
    for (const runner of field.runners) {
      const head = runnerHead(runner)
      expect(head.x).toBeGreaterThanOrEqual(1)
      expect(head.x).toBeLessThanOrEqual(bounds.cols - 1)
      expect(head.y).toBeGreaterThanOrEqual(1)
      expect(head.y).toBeLessThanOrEqual(bounds.rows - 1)
      // 头部至少有一个坐标落在整数网格线上
      const onLine = Number.isInteger(Math.round(head.x * 1e6) / 1e6) || Number.isInteger(Math.round(head.y * 1e6) / 1e6)
      expect(onLine).toBe(true)
    }
  }
})

test('转向只发生在交叉点，且不会原地掉头', () => {
  const field = createRunnerField({ cols: 30, rows: 30 }, { count: 1, turnChance: 1, speed: 1, random: seeded(3) })
  const runner = field.runners[0]!
  let previousDir = runner.dir
  for (let i = 0; i < 400; i += 1) {
    const before = runner.progress
    field.step(0.25)
    if (runner.progress < before) {
      // 刚经过交叉点
      expect(runner.dir).not.toBe((previousDir + 2) % 4)
      previousDir = runner.dir
    } else {
      expect(runner.dir).toBe(previousDir)
    }
  }
})

test('拖尾长度按格数截断并且从头到尾连续', () => {
  const field = createRunnerField({ cols: 40, rows: 40 }, { count: 1, trailCells: 5, speed: 4, random: seeded(11) })
  const runner = field.runners[0]!
  for (let i = 0; i < 300; i += 1) field.step(1 / 30)
  const points = trailPoints(runner, 5)
  let length = 0
  for (let i = 0; i < points.length - 1; i += 1) {
    length += Math.abs(points[i + 1]!.x - points[i]!.x) + Math.abs(points[i + 1]!.y - points[i]!.y)
  }
  expect(length).toBeCloseTo(5, 5)
  expect(points[0]).toEqual(runnerHead(runner))
  expect(runner.path.length).toBeLessThanOrEqual(7)
})

test('视口缩小后把船拉回界内', () => {
  const field = createRunnerField({ cols: 40, rows: 40 }, { count: 5, random: seeded(5) })
  field.resize({ cols: 6, rows: 6 })
  for (const runner of field.runners) {
    expect(runner.cx).toBeGreaterThanOrEqual(1)
    expect(runner.cx).toBeLessThanOrEqual(5)
    expect(runner.cy).toBeGreaterThanOrEqual(1)
    expect(runner.cy).toBeLessThanOrEqual(5)
    expect(runner.cx + DIR_DX[runner.dir]).toBeGreaterThanOrEqual(1)
    expect(runner.cy + DIR_DY[runner.dir]).toBeLessThanOrEqual(5)
  }
})

test('视口小到放不下时不生成船', () => {
  expect(createRunnerField({ cols: 2, rows: 2 }).runners).toHaveLength(0)
})

test('星星用归一化坐标，数量可配', () => {
  expect(GRID_STAR_COUNT).toBe(120)
  const stars = createStars(8, seeded(9))
  expect(stars).toHaveLength(8)
  for (const star of stars) {
    expect(star.u).toBeGreaterThanOrEqual(0)
    expect(star.u).toBeLessThanOrEqual(1)
    expect(star.v).toBeGreaterThanOrEqual(0)
    expect(star.v).toBeLessThanOrEqual(1)
    expect(star.size).toBeGreaterThan(0)
  }
  expect(createStars(0)).toHaveLength(0)
})

test('鼠标高亮按距离二次衰减，圆外为 0', () => {
  expect(gridGlowAt(0, 0)).toBe(1)
  expect(gridGlowAt(110, 0, 220)).toBeCloseTo(0.25, 5)
  expect(gridGlowAt(220, 0, 220)).toBe(0)
  expect(gridGlowAt(300, 0, 220)).toBe(0)
})
