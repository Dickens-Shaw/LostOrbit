export const CUBE_SIZE = 0.44
export const CUBE_SPACING = 0.48
export const DEPTH_LAYERS = 2
export const DIGIT_GAP = 1.1

export const CHAR_MAPS = {
  '4': [
    '1000011',
    '1100011',
    '1100011',
    '1010011',
    '1111111',
    '1111111',
    '0000011',
    '0000011',
    '0000011',
  ],
  '0': [
    '1111111',
    '1111111',
    '1100011',
    '1100011',
    '1100011',
    '1100011',
    '1100011',
    '1111111',
    '1111111',
  ],
} as const

export type FactoryDigit = keyof typeof CHAR_MAPS

export type FactoryVoxel = {
  x: number
  y: number
  z: number
  layer: 0 | 1
  digitIndex: number
}

export function isChamferedOut(char: FactoryDigit, x: number, y: number): boolean {
  if (char === '4') {
    if (y === 8 && x === 1) return true
    if (y === 3 && (x === 1 || x === 2)) return true
  }
  if (char === '0') {
    if ((x === 0 || x === 6) && (y === 0 || y === 8)) return true
    if ((x === 2 || x === 4) && (y === 2 || y === 6)) return true
  }
  return false
}

export function buildFactoryVoxels(): FactoryVoxel[] {
  const digits: FactoryDigit[] = ['4', '0', '4']
  const charWidth = 7 * CUBE_SPACING
  const totalWidth = charWidth * digits.length + DIGIT_GAP * (digits.length - 1)
  const startX = -totalWidth / 2 + charWidth / 2
  const voxels: FactoryVoxel[] = []

  digits.forEach((digit, digitIndex) => {
    const map = CHAR_MAPS[digit]
    const charOffsetX = startX + digitIndex * (charWidth + DIGIT_GAP)

    map.forEach((row, r) => {
      const y = (map.length / 2 - r) * CUBE_SPACING
      ;[...row].forEach((bit, c) => {
        if (bit !== '1') return
        for (let layer = 0; layer < DEPTH_LAYERS; layer += 1) {
          if (isChamferedOut(digit, c, map.length - 1 - r)) continue
          voxels.push({
            x: charOffsetX + (c - row.length / 2) * CUBE_SPACING,
            y,
            z: (layer - (DEPTH_LAYERS - 1) / 2) * CUBE_SPACING,
            layer: layer as 0 | 1,
            digitIndex,
          })
        }
      })
    })
  })

  return voxels
}

export const VOXEL_ON_COUNT = buildFactoryVoxels().length

/** 404 体素半宽 / 半高，构图时要整组落在视锥里。 */
export const FACTORY_HALF_WIDTH = 7.8
export const FACTORY_HALF_HEIGHT = 5.2
export const FACTORY_FOV = 36
export const FACTORY_BASE_DISTANCE = 25.8

export type FactoryFrame = {
  aspect: number
  distance: number
  far: number
  stageY: number
  stationX: number
  stationY: number
}

/** 按视口算出相机距离和门的位置。竖屏会拉远，避免首帧按桌面距离构图把 404 裁掉。 */
export function planFactoryFrame(width: number, height: number): FactoryFrame {
  const aspect = Math.max(width, 1) / Math.max(height, 1)
  const halfFov = (FACTORY_FOV * Math.PI) / 360
  const tan = Math.tan(halfFov)
  const distanceW = FACTORY_HALF_WIDTH / (tan * aspect)
  const distanceH = FACTORY_HALF_HEIGHT / tan
  const distance = Math.max(FACTORY_BASE_DISTANCE, distanceW, distanceH)
  const halfHeight = tan * distance
  const halfWidth = halfHeight * aspect
  const portrait = aspect < 0.85
  return {
    aspect,
    distance,
    far: Math.max(120, distance * 4),
    stageY: portrait ? -0.35 : -1.35,
    stationX: -Math.min(Math.max(halfWidth * (portrait ? 0.72 : 0.55), portrait ? 4.8 : 3.2), portrait ? 6.2 : 9.9),
    stationY: Math.min(Math.max(halfHeight * (portrait ? 0.5 : 0.42), portrait ? 3.1 : 1.8), portrait ? 4.4 : 3.6),
  }
}
