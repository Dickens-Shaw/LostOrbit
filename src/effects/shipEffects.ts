import * as THREE from 'three'
import { trailLengthForSpeed, trimTrailToLength } from '../flight/portalDeparture'

/**
 * 飞船尾焰与翼尖尾迹。两者都由实测机速驱动：
 * - 尾焰：喷口处的白热核心（渐隐的锥体）+ 一串向后飘、越远越淡的辉光片 + 零星火星，
 *   长度、宽度、流速、亮度都随速度伸缩；
 * - 尾迹：把翼尖历史点写成面向相机的带状网格，头部宽、尾部收尖，颜色沿长度衰减到黑（叠加混合下即透明）。
 */

export type PlumeProfile = {
  /** 尾焰长度，单位为喷口半径的倍数。 */
  length: number
  /** 尾焰宽度系数（1 = 喷口直径）。 */
  width: number
  /** 辉光片每秒循环次数。 */
  flow: number
  /** 整体亮度 0~1。 */
  intensity: number
}

export function plumeProfileForSpeed(speedRatio: number): PlumeProfile {
  const ratio = Math.min(1.65, Math.max(0, speedRatio))
  return {
    // 主喷口半径 0.075 时全速约 3 单位；穿 0 时由场景用 maxLength 截短，尾焰不会穿过短臂追尾镜头。
    length: 6 + ratio * ratio * 34,
    width: 1.2 + ratio * 0.8,
    flow: 1.4 + ratio * 3.4,
    intensity: Math.min(1, 0.08 + ratio * 1.5),
  }
}

/** 辉光片沿尾焰的排布：先略微鼓起再收尖，越靠尾端越淡。cycle 0 = 喷口，1 = 尾端。 */
export function puffLayout(cycle: number, profile: PlumeProfile) {
  const t = Math.min(1, Math.max(0, cycle))
  const swell = 0.55 + 0.75 * Math.sin(Math.PI * Math.min(1, t * 1.25 + 0.08))
  return {
    along: t * profile.length,
    size: profile.width * swell,
    alpha: profile.intensity * Math.pow(1 - t, 1.7),
  }
}

export type TrailProfile = { length: number; width: number; opacity: number }

export function trailProfileForSpeed(speedRatio: number): TrailProfile {
  const ratio = Math.min(1.65, Math.max(0, speedRatio))
  return {
    length: trailLengthForSpeed(Math.min(1, ratio)),
    width: 0.014 + ratio * 0.05,
    opacity: 0.25 + ratio * 0.65,
  }
}

type Rgb = readonly [number, number, number]

/**
 * 把历史点列写成面向 camera 的带状三角网格。points 为 xyz 交错、按时间升序（末尾是最新点）。
 * 宽度从尾端 0 渐变到头部 headWidth，颜色从 tail 渐变到 head。返回写入的顶点数（= count * 2）。
 */
export function writeRibbon(
  points: ArrayLike<number>,
  count: number,
  camera: { x: number; y: number; z: number },
  headWidth: number,
  head: Rgb,
  tail: Rgb,
  out: { positions: Float32Array; colors: Float32Array },
): number {
  if (count < 2) return 0
  let sx = 0
  let sy = 1
  let sz = 0
  for (let i = 0; i < count; i += 1) {
    const px = points[i * 3]!
    const py = points[i * 3 + 1]!
    const pz = points[i * 3 + 2]!
    const prev = Math.max(0, i - 1)
    const next = Math.min(count - 1, i + 1)
    const dx = points[next * 3]! - points[prev * 3]!
    const dy = points[next * 3 + 1]! - points[prev * 3 + 1]!
    const dz = points[next * 3 + 2]! - points[prev * 3 + 2]!
    const cx = camera.x - px
    const cy = camera.y - py
    const cz = camera.z - pz
    // side = normalize(dir × toCamera)：垂直于航迹又垂直于视线，带面始终正对相机。
    const nx = dy * cz - dz * cy
    const ny = dz * cx - dx * cz
    const nz = dx * cy - dy * cx
    const len = Math.hypot(nx, ny, nz)
    if (len > 1e-8) {
      sx = nx / len
      sy = ny / len
      sz = nz / len
    }
    const t = i / (count - 1)
    const half = headWidth * Math.pow(t, 0.6) * 0.5
    const mix = Math.pow(t, 2.4)
    const r = tail[0] + (head[0] - tail[0]) * mix
    const g = tail[1] + (head[1] - tail[1]) * mix
    const b = tail[2] + (head[2] - tail[2]) * mix
    const v = i * 6
    out.positions[v] = px - sx * half
    out.positions[v + 1] = py - sy * half
    out.positions[v + 2] = pz - sz * half
    out.positions[v + 3] = px + sx * half
    out.positions[v + 4] = py + sy * half
    out.positions[v + 5] = pz + sz * half
    out.colors[v] = r
    out.colors[v + 1] = g
    out.colors[v + 2] = b
    out.colors[v + 3] = r
    out.colors[v + 4] = g
    out.colors[v + 5] = b
  }
  return count * 2
}

/** 带状网格的三角索引：每对相邻点之间两个三角形。 */
export function ribbonIndices(maxPoints: number): Uint16Array {
  const indices = new Uint16Array(Math.max(0, maxPoints - 1) * 6)
  for (let i = 0; i < maxPoints - 1; i += 1) {
    const a = i * 2
    const o = i * 6
    indices[o] = a
    indices[o + 1] = a + 1
    indices[o + 2] = a + 2
    indices[o + 3] = a + 1
    indices[o + 4] = a + 3
    indices[o + 5] = a + 2
  }
  return indices
}

export type ExhaustEngine = { x: number; y: number; z: number; radius: number }

const PUFF_COUNT = 12
const EMBER_COUNT = 18

const PLUME_VERTEX = /* glsl */ `
  varying float vAlong;
  varying float vAngle;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vAlong = clamp(-position.z, 0.0, 1.0);
    vAngle = atan(position.y, position.x);
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vView = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const PLUME_FRAGMENT = /* glsl */ `
  uniform vec3 uHot;
  uniform vec3 uWarm;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uSeed;
  uniform float uKnots;
  uniform float uKnotGain;
  varying float vAlong;
  varying float vAngle;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    // 正对视线的表面最亮，轮廓边缘渐隐，柱体就不再是硬边几何体而像一团半透明的气。
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    float rim = pow(facing, 0.7);
    // 沿长度只缓慢变暗，柱体大半段保持可见，最后 30% 收尾渐隐（参考图里柱子接近顶端才消散）。
    float along = mix(1.0, 0.4, vAlong) * (1.0 - smoothstep(0.7, 1.0, vAlong));
    // 半透明雾体 + 细微流动纹理。
    float haze = 0.6 + 0.1 * sin(vAlong * 30.0 - uTime * 18.0 + uSeed + sin(vAngle * 2.0 + uTime * 3.0) * 0.6);
    // 激波节：沿长度等距的一串亮结，缓慢向后流动，只在柱心显现（参考图里柱子中间的亮点）。
    float wave = 0.5 + 0.5 * cos(vAlong * 6.2832 * uKnots - uTime * 3.2 + uSeed);
    float knots = pow(wave, 7.0) * pow(facing, 3.0) * uKnotGain;
    float alpha = uOpacity * rim * along * (haze + knots);
    vec3 color = mix(uHot, uWarm, smoothstep(0.0, 0.45, vAlong) * 0.85);
    gl_FragColor = vec4(color * alpha, alpha);
    // 和场景里其它材质一样过一遍色调映射与输出色彩空间，暗部不会被线性→sRGB 的缺失压黑。
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function plumeShellMaterial(seed: number, knots: number, knotGain: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uHot: { value: new THREE.Color(0xefe6cf) },
      uWarm: { value: new THREE.Color(0xc8a96b) },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      uSeed: { value: seed },
      uKnots: { value: knots },
      uKnotGain: { value: knotGain },
    },
    vertexShader: PLUME_VERTEX,
    fragmentShader: PLUME_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
}

function additiveSprite(map: THREE.Texture | null) {
  return new THREE.SpriteMaterial({
    map,
    color: 0xc8a96b,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
}

/** 一台发动机的尾焰，挂在机身局部坐标里，喷口在 (x, y, z)，向 -z 喷。 */
export function createExhaustPlume(engine: ExhaustEngine, glowMap: THREE.Texture | null) {
  const group = new THREE.Group()
  group.position.set(engine.x, engine.y, engine.z)
  group.visible = false
  const r = engine.radius

  // 两层软边柱体（略收口）：内层带激波节的核心，外层雾化鞘宽而淡。几何按喷口半径建模，z∈[-1, 0]，喷口在 0。
  const coreGeo = new THREE.CylinderGeometry(r * 0.5, r, 1, 18, 12, true)
  coreGeo.rotateX(-Math.PI / 2)
  coreGeo.translate(0, 0, -0.5)
  const seed = Math.random() * 6.28
  const coreMat = plumeShellMaterial(seed, 5, 1.6)
  const core = new THREE.Mesh(coreGeo, coreMat)
  core.frustumCulled = false
  group.add(core)
  const hazeMat = plumeShellMaterial(seed, 5, 0.35)
  const haze = new THREE.Mesh(coreGeo, hazeMat)
  haze.frustumCulled = false
  group.add(haze)

  // 喷口闪光。
  const flareMat = additiveSprite(glowMap)
  const flare = new THREE.Sprite(flareMat)
  group.add(flare)

  // 一串辉光片：各自带相位，沿 -z 循环向后飘。
  const hot = new THREE.Color(0xefe6cf)
  const warm = new THREE.Color(0xc8a96b)
  const puffs = Array.from({ length: PUFF_COUNT }, (_, index) => {
    const material = additiveSprite(glowMap)
    const sprite = new THREE.Sprite(material)
    group.add(sprite)
    return { sprite, material, phase: index / PUFF_COUNT }
  })

  // 火星：局部坐标里向后飞，飞出尾焰长度就回到喷口重新来。
  const emberPos = new Float32Array(EMBER_COUNT * 3)
  const emberSeed = new Float32Array(EMBER_COUNT * 2)
  for (let i = 0; i < EMBER_COUNT; i += 1) {
    emberSeed[i * 2] = Math.random()
    emberSeed[i * 2 + 1] = Math.random() * Math.PI * 2
    emberPos[i * 3 + 2] = -Math.random()
  }
  const emberGeo = new THREE.BufferGeometry()
  const emberAttr = new THREE.BufferAttribute(emberPos, 3)
  emberGeo.setAttribute('position', emberAttr)
  const emberMat = new THREE.PointsMaterial({
    map: glowMap,
    color: 0xefe6cf,
    size: r * 0.9,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  const embers = new THREE.Points(emberGeo, emberMat)
  embers.frustumCulled = false
  group.add(embers)

  let phase = 0
  let time = 0
  const tint = new THREE.Color()

  return {
    group,
    /** 每帧更新：profile 来自机速，fade 用于入门时整体熄灭，maxLength 为绝对长度上限（穿 0 时截短）。 */
    update(delta: number, profile: PlumeProfile, fade: number, maxLength = Infinity) {
      time += delta
      phase += delta * profile.flow
      const length = Math.min(profile.length * r, maxLength)
      const width = profile.width * r * 2
      const glow = profile.intensity * fade
      group.visible = glow > 0.01
      if (!group.visible) return

      const flicker = 0.92 + Math.sin(time * 23) * 0.05 + Math.sin(time * 41 + 1.3) * 0.03
      // 柱体几何已按喷口半径建模，这里只乘无量纲的宽度系数和绝对长度。
      core.scale.set(profile.width * 0.8, profile.width * 0.8, length * 0.92)
      coreMat.uniforms.uOpacity!.value = glow * 1.15 * flicker
      coreMat.uniforms.uTime!.value = time
      haze.scale.set(profile.width * 1.8, profile.width * 1.8, length)
      hazeMat.uniforms.uOpacity!.value = glow * 0.62 * flicker
      hazeMat.uniforms.uTime!.value = time
      flare.scale.setScalar(width * 1.3 * (0.9 + flicker * 0.2))
      flareMat.opacity = glow * 0.3

      for (const puff of puffs) {
        const cycle = (phase + puff.phase) % 1
        const layout = puffLayout(cycle, profile)
        puff.sprite.position.set(
          Math.sin(time * 9 + puff.phase * 17) * r * 0.12 * cycle,
          Math.cos(time * 7 + puff.phase * 11) * r * 0.12 * cycle,
          -layout.along * r,
        )
        puff.sprite.scale.setScalar(layout.size * r * 3.2)
        puff.material.opacity = layout.alpha * fade * 0.3 * flicker
        tint.copy(hot).lerp(warm, Math.min(1, cycle * 2.2))
        puff.material.color.copy(tint)
      }

      const drift = length * profile.flow * 0.55 * delta
      for (let i = 0; i < EMBER_COUNT; i += 1) {
        let z = emberPos[i * 3 + 2]! - drift * (0.6 + emberSeed[i * 2]! * 0.8)
        if (z < -length) z += length
        const spread = r * 0.9 * (0.3 + (-z / Math.max(0.001, length)) * 1.2)
        const angle = emberSeed[i * 2 + 1]! + time * (0.6 + emberSeed[i * 2]!)
        emberPos[i * 3] = Math.cos(angle) * spread
        emberPos[i * 3 + 1] = Math.sin(angle) * spread
        emberPos[i * 3 + 2] = z
      }
      emberAttr.needsUpdate = true
      emberMat.opacity = glow * 0.4
      emberMat.size = r * (0.5 + profile.intensity * 0.5)
    },
    reset() {
      phase = 0
      time = 0
      group.visible = false
    },
    paint(coreColor: THREE.Color, glowColor: THREE.Color) {
      hot.copy(coreColor).lerp(new THREE.Color(0xffffff), 0.2)
      warm.copy(glowColor)
      for (const material of [coreMat, hazeMat]) {
        ;(material.uniforms.uHot!.value as THREE.Color).copy(hot)
        ;(material.uniforms.uWarm!.value as THREE.Color).copy(glowColor)
      }
      flareMat.color.copy(hot)
      emberMat.color.copy(coreColor)
    },
    dispose() {
      coreGeo.dispose()
      coreMat.dispose()
      hazeMat.dispose()
      flareMat.dispose()
      puffs.forEach(({ material }) => material.dispose())
      emberGeo.dispose()
      emberMat.dispose()
    },
  }
}

export type ExhaustPlume = ReturnType<typeof createExhaustPlume>

/** 一道翼尖尾迹：外层宽而淡的光带 + 内层窄而亮的芯线，共用同一份历史点。 */
export function createWingTrail(maxPoints: number) {
  const points = new Float32Array(maxPoints * 3)
  const indices = ribbonIndices(maxPoints)
  const makeLayer = () => {
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(maxPoints * 6)
    const colors = new Float32Array(maxPoints * 6)
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
    geometry.setDrawRange(0, 0)
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.visible = false
    return { geometry, material, mesh, positions, colors }
  }
  const glow = makeLayer()
  const core = makeLayer()
  const group = new THREE.Group()
  group.add(glow.mesh, core.mesh)

  const glowHead: [number, number, number] = [0.78, 0.66, 0.42]
  const coreHead: [number, number, number] = [0.94, 0.9, 0.81]
  const black: Rgb = [0, 0, 0]
  let count = 0

  const writeLayer = (layer: ReturnType<typeof makeLayer>, camera: THREE.Vector3, width: number, head: Rgb) => {
    const vertices = writeRibbon(points, count, camera, width, head, black, layer)
    ;(layer.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    ;(layer.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true
    layer.geometry.setDrawRange(0, vertices >= 4 ? (count - 1) * 6 : 0)
  }

  return {
    group,
    get count() {
      return count
    },
    /** 记录翼尖当前位置（stage 局部坐标）；几乎没动就不补点。 */
    push(x: number, y: number, z: number) {
      const last = count - 1
      const moved =
        count === 0 || Math.hypot(x - points[last * 3]!, y - points[last * 3 + 1]!, z - points[last * 3 + 2]!) > 0.006
      if (!moved) return
      let index = count
      if (count >= maxPoints) {
        points.copyWithin(0, 3)
        index = maxPoints - 1
      } else {
        count += 1
      }
      points[index * 3] = x
      points[index * 3 + 1] = y
      points[index * 3 + 2] = z
    },
    /** 按速度对应的尾迹形态重写网格：裁弧长、定宽度与亮度。camera 为 stage 局部坐标。 */
    update(camera: THREE.Vector3, profile: TrailProfile, fade: number) {
      count = trimTrailToLength(points, count, profile.length)
      const opacity = profile.opacity * fade
      const visible = count > 1 && opacity > 0.01
      glow.mesh.visible = visible
      core.mesh.visible = visible
      if (!visible) return
      writeLayer(glow, camera, profile.width, glowHead)
      writeLayer(core, camera, profile.width * 0.3, coreHead)
      glow.material.opacity = opacity * 0.4
      core.material.opacity = opacity
    },
    reset() {
      count = 0
      glow.geometry.setDrawRange(0, 0)
      core.geometry.setDrawRange(0, 0)
      glow.mesh.visible = false
      core.mesh.visible = false
    },
    paint(coreColor: THREE.Color, glowColor: THREE.Color) {
      glowHead[0] = glowColor.r
      glowHead[1] = glowColor.g
      glowHead[2] = glowColor.b
      const hot = coreColor.clone().lerp(new THREE.Color(0xffffff), 0.3)
      coreHead[0] = hot.r
      coreHead[1] = hot.g
      coreHead[2] = hot.b
    },
    dispose() {
      glow.geometry.dispose()
      glow.material.dispose()
      core.geometry.dispose()
      core.material.dispose()
    },
  }
}

export type WingTrail = ReturnType<typeof createWingTrail>

/** 撞机爆炸的时间线（秒）：闪光最亮的时刻、火星/碎片飞散的总时长。 */
export const EXPLOSION = { duration: 1.5, flashPeak: 0.08, sparkCount: 72, debrisCount: 10 } as const

/** 爆炸各阶段的强度：闪光快起快落，火星与碎片随时间衰减。t 为爆炸开始后的秒数。 */
export function explosionProfile(t: number) {
  const life = Math.min(1, Math.max(0, t / EXPLOSION.duration))
  const flash =
    t < EXPLOSION.flashPeak ? t / EXPLOSION.flashPeak : Math.max(0, 1 - (t - EXPLOSION.flashPeak) / 0.4)
  return {
    life,
    flash,
    spark: Math.pow(1 - life, 1.6),
    debris: 1 - Math.pow(life, 2.2),
    done: t >= EXPLOSION.duration,
  }
}

/**
 * 玩家撞机时的爆炸：一团白热闪光 + 外圈辉光、向四周飞散并减速的火星、几块带自旋的机体碎片。
 * 挂在 stage 上（stage 局部坐标），trigger 时把机身当前位置和航向传进来，碎片会沿航向略带前冲。
 */
export function createShipExplosion(glowMap: THREE.Texture, hullMaterial: THREE.Material) {
  const group = new THREE.Group()
  group.visible = false

  const flashMat = new THREE.SpriteMaterial({
    map: glowMap,
    color: 0xfff4dc,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
  const haloMat = flashMat.clone()
  haloMat.color.set(0xc8a96b)
  const flash = new THREE.Sprite(flashMat)
  const halo = new THREE.Sprite(haloMat)
  group.add(flash, halo)

  const sparkPositions = new Float32Array(EXPLOSION.sparkCount * 3)
  const sparkVelocity = new Float32Array(EXPLOSION.sparkCount * 3)
  const sparkGeo = new THREE.BufferGeometry()
  const sparkAttr = new THREE.BufferAttribute(sparkPositions, 3)
  sparkGeo.setAttribute('position', sparkAttr)
  const sparkMat = new THREE.PointsMaterial({
    map: glowMap,
    color: 0xefe6cf,
    size: 0.16,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const sparks = new THREE.Points(sparkGeo, sparkMat)
  sparks.frustumCulled = false
  group.add(sparks)

  const debrisGeo = new THREE.BoxGeometry(0.09, 0.05, 0.14)
  const debris: { mesh: THREE.Mesh; velocity: THREE.Vector3; spin: THREE.Vector3 }[] = []
  for (let i = 0; i < EXPLOSION.debrisCount; i += 1) {
    const mesh = new THREE.Mesh(debrisGeo, hullMaterial)
    group.add(mesh)
    debris.push({ mesh, velocity: new THREE.Vector3(), spin: new THREE.Vector3() })
  }

  const origin = new THREE.Vector3()
  let elapsed = -1

  return {
    group,
    get active() {
      return elapsed >= 0
    },
    trigger(position: THREE.Vector3, heading: THREE.Vector3) {
      elapsed = 0
      origin.copy(position)
      group.visible = true
      group.position.set(0, 0, 0)
      flash.position.copy(origin)
      halo.position.copy(origin)
      for (let i = 0; i < EXPLOSION.sparkCount; i += 1) {
        const theta = Math.random() * Math.PI * 2
        const phi = Math.acos(Math.random() * 2 - 1)
        const speed = 1.4 + Math.random() * 3.6
        sparkVelocity[i * 3] = Math.sin(phi) * Math.cos(theta) * speed + heading.x * 1.2
        sparkVelocity[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * speed + heading.y * 1.2
        sparkVelocity[i * 3 + 2] = Math.cos(phi) * speed + heading.z * 1.2
        sparkPositions[i * 3] = origin.x
        sparkPositions[i * 3 + 1] = origin.y
        sparkPositions[i * 3 + 2] = origin.z
      }
      sparkAttr.needsUpdate = true
      for (const piece of debris) {
        piece.mesh.visible = true
        piece.mesh.position.copy(origin)
        piece.mesh.scale.setScalar(0.7 + Math.random() * 0.9)
        piece.velocity
          .set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
          .normalize()
          .multiplyScalar(0.9 + Math.random() * 2.2)
          .addScaledVector(heading, 1.5)
        piece.spin.set(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4)
      }
    },
    update(delta: number) {
      if (elapsed < 0) return
      elapsed += delta
      const profile = explosionProfile(elapsed)
      if (profile.done) {
        elapsed = -1
        group.visible = false
        return
      }
      flash.scale.setScalar(0.6 + profile.flash * 2.6)
      halo.scale.setScalar(1.4 + (1 - profile.spark) * 4)
      flashMat.opacity = profile.flash
      haloMat.opacity = profile.flash * 0.5 + profile.spark * 0.18
      const drag = Math.exp(-delta * 2.2)
      for (let i = 0; i < EXPLOSION.sparkCount * 3; i += 1) {
        sparkPositions[i] = sparkPositions[i]! + sparkVelocity[i]! * delta
        sparkVelocity[i] = sparkVelocity[i]! * drag
      }
      sparkAttr.needsUpdate = true
      sparkMat.opacity = profile.spark
      sparkMat.size = 0.08 + profile.spark * 0.12
      for (const piece of debris) {
        piece.mesh.position.addScaledVector(piece.velocity, delta)
        piece.velocity.multiplyScalar(Math.exp(-delta * 1.1))
        piece.mesh.rotation.x += piece.spin.x * delta
        piece.mesh.rotation.y += piece.spin.y * delta
        piece.mesh.rotation.z += piece.spin.z * delta
        piece.mesh.visible = profile.debris > 0.05
        const shrink = 0.7 + profile.debris * 0.6
        piece.mesh.scale.setScalar(shrink)
      }
    },
    paint(coreColor: THREE.Color, glowColor: THREE.Color) {
      flashMat.color.copy(coreColor).lerp(new THREE.Color(0xffffff), 0.5)
      haloMat.color.copy(glowColor)
      sparkMat.color.copy(coreColor)
    },
    dispose() {
      flashMat.dispose()
      haloMat.dispose()
      sparkGeo.dispose()
      sparkMat.dispose()
      debrisGeo.dispose()
    },
  }
}

export type ShipExplosion = ReturnType<typeof createShipExplosion>
