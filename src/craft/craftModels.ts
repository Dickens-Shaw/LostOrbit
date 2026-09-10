import * as THREE from 'three'

/**
 * 两种飞船的积木式模型，只用盒子 / 圆柱拼出大致结构，不带贴图。
 * 机身沿 +z 排布（lookAt 会把 +z 对准目标），+x 在飞船左侧，+y 朝上。
 * 材质只有三种：hull（主体深色）、trim（点缀亮色）、glow（发光）。
 */
export type CraftMaterials = {
  hull: THREE.Material
  trim: THREE.Material
  glow: THREE.Material
}

type Placement = {
  x?: number
  y?: number
  z?: number
  /** 绕 x / y / z 的旋转（弧度）。 */
  rx?: number
  ry?: number
  rz?: number
}

function place(mesh: THREE.Mesh, at: Placement) {
  mesh.position.set(at.x ?? 0, at.y ?? 0, at.z ?? 0)
  mesh.rotation.set(at.rx ?? 0, at.ry ?? 0, at.rz ?? 0)
  return mesh
}

function makeBuilder(group: THREE.Group) {
  const box = (w: number, h: number, d: number, material: THREE.Material, at: Placement = {}) => {
    const mesh = place(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material), at)
    group.add(mesh)
    return mesh
  }
  const cylinder = (radius: number, height: number, material: THREE.Material, at: Placement = {}, segments = 20) => {
    const mesh = place(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), material), at)
    group.add(mesh)
    return mesh
  }
  /** 左右对称各放一个。 */
  const mirrored = (build: (side: 1 | -1) => THREE.Mesh) => [build(1), build(-1)] as const
  return { box, cylinder, mirrored }
}

/** 尾迹起点：翼尖垂尾顶端的亮色块正后方（机身局部系），气动尾迹从这里拖出。 */
export const FIGHTER_WINGTIP = { x: 0.545, y: 0.235, z: -0.38 } as const
/** 战机三个喷口（机身局部坐标）：中央主喷口 + 翼下两台短舱，尾焰从这里向 -z 喷。 */
export const FIGHTER_EXHAUSTS = [
  { x: 0, y: 0, z: -0.495, radius: 0.075 },
  { x: 0.29, y: -0.095, z: -0.385, radius: 0.05 },
  { x: -0.29, y: -0.095, z: -0.385, radius: 0.05 },
] as const

/**
 * 参考图下方的战机：细长机身 + 机头进气口、驾驶舱座舱盖、背部机炮、后掠翼、翼下双发短舱、
 * 翼尖外倾双垂尾、腹部小鳍、尾部主喷口。整机长约 1.3，翼展约 1.2。
 */
export function buildFighter(group: THREE.Group, { hull, trim, glow }: CraftMaterials): { emitter: THREE.Mesh } {
  const { box, mirrored } = makeBuilder(group)

  // 机身：后段方、前段收窄，机头进气口用亮色框住，发射点就是进气口里的光。
  box(0.2, 0.16, 0.86, hull, { z: 0.02 })
  box(0.17, 0.13, 0.32, hull, { y: -0.005, z: 0.6 })
  box(0.15, 0.11, 0.05, trim, { y: -0.005, z: 0.775 })
  const emitter = box(0.1, 0.07, 0.04, glow, { y: -0.005, z: 0.8 })

  // 座舱盖靠前偏上，后面一条背脊；背脊上架一根机炮。
  box(0.14, 0.09, 0.3, trim, { y: 0.115, z: 0.16 })
  box(0.12, 0.06, 0.34, hull, { y: 0.1, z: -0.16 })
  box(0.035, 0.035, 0.36, hull, { x: 0.045, y: 0.185, z: 0.02 })
  box(0.045, 0.045, 0.06, trim, { x: 0.045, y: 0.185, z: 0.22 })

  mirrored((side) => {
    // 后掠翼：从机身根部向外、向后扫（绕 y 正向转把外端推向 -z），翼尖略下反。
    box(0.5, 0.035, 0.3, hull, { x: side * 0.33, y: -0.03, z: -0.06, ry: side * 0.36, rz: -side * 0.04 })
    // 翼下发动机短舱 + 尾喷口。
    box(0.12, 0.11, 0.42, hull, { x: side * 0.29, y: -0.095, z: -0.1 })
    box(0.1, 0.09, 0.05, trim, { x: side * 0.29, y: -0.095, z: -0.335 })
    box(0.07, 0.06, 0.04, glow, { x: side * 0.29, y: -0.095, z: -0.365 })
    // 翼尖外倾垂尾，向后掠（绕 x 负向转把顶端推向 -z）。
    box(0.03, 0.28, 0.16, hull, { x: side * 0.5, y: 0.1, z: -0.24, rz: -side * 0.28, rx: -0.32 })
    box(0.032, 0.05, 0.1, trim, { x: side * 0.535, y: 0.225, z: -0.32, rz: -side * 0.28, rx: -0.32 })
    // 腹部小鳍。
    return box(0.025, 0.1, 0.14, hull, { x: side * 0.11, y: -0.13, z: -0.3, rz: side * 0.35 })
  })

  // 尾部主喷口。
  box(0.15, 0.11, 0.06, trim, { z: -0.44 })
  box(0.1, 0.075, 0.04, glow, { z: -0.475 })

  return { emitter }
}

/**
 * 参考图上方的运输船：扁宽的碟形主体 + 上层甲板与雷达盘、右侧偏置的驾驶舱管、
 * 尾部一对大发动机舱（后端发光）、腹部起落架短柱。整机长约 1.1，宽约 0.75。
 */
export function buildFreighter(group: THREE.Group, { hull, trim, glow }: CraftMaterials): { emitter: THREE.Mesh } {
  const { box, cylinder, mirrored } = makeBuilder(group)

  // 主体两层扁八边形碟身：底盘宽、上层收窄；前缘一条亮色收边。
  cylinder(0.36, 0.12, hull, { z: -0.02, ry: Math.PI / 8 }, 8)
  cylinder(0.26, 0.08, hull, { y: 0.09, z: -0.04, ry: Math.PI / 8 }, 8)
  box(0.3, 0.04, 0.06, trim, { y: -0.005, z: 0.33 })
  // 顶部雷达盘（略偏左），一圈亮边。
  cylinder(0.1, 0.025, hull, { x: 0.05, y: 0.14, z: -0.04 })
  cylinder(0.045, 0.03, trim, { x: 0.05, y: 0.155, z: -0.04 }, 12)

  // 右侧偏置的驾驶舱管：伸到主体前方，末端是座舱盖，舱盖里的光就是发射点。
  box(0.11, 0.1, 0.5, hull, { x: -0.22, y: 0.03, z: 0.26 })
  box(0.085, 0.07, 0.12, trim, { x: -0.22, y: 0.05, z: 0.5 })
  const emitter = box(0.06, 0.045, 0.03, glow, { x: -0.22, y: 0.05, z: 0.565 })

  // 左前伸出的货舱臂，和驾驶舱管对称呼应但更短更粗。
  box(0.14, 0.11, 0.3, hull, { x: 0.2, y: -0.005, z: 0.28 })
  box(0.1, 0.08, 0.04, trim, { x: 0.2, y: -0.005, z: 0.44 })

  mirrored((side) => {
    // 尾部发动机舱：粗壮的方管，后端亮框 + 发光。
    box(0.16, 0.14, 0.4, hull, { x: side * 0.24, y: 0.01, z: -0.36 })
    box(0.13, 0.11, 0.05, trim, { x: side * 0.24, y: 0.01, z: -0.575 })
    box(0.09, 0.07, 0.04, glow, { x: side * 0.24, y: 0.01, z: -0.605 })
    // 侧面散热片。
    box(0.02, 0.06, 0.24, trim, { x: side * 0.335, y: 0.03, z: -0.3 })
    // 腹部起落架短柱。
    return box(0.03, 0.08, 0.03, trim, { x: side * 0.18, y: -0.1, z: 0.1 })
  })
  box(0.03, 0.08, 0.03, trim, { y: -0.1, z: -0.3 })

  return { emitter }
}
