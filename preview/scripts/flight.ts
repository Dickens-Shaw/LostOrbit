import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildFactoryVoxels, CUBE_SIZE, CUBE_SPACING } from '../../src/layout/absentFactoryLayout'
import {
  buildAlignTurn,
  buildDepartureWaypoints,
  flightEase,
  planCruiseStage,
} from '../../src/flight/portalDeparture'

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
document.body.append(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 400)
camera.position.set(18, 14, 28)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.target.set(0, 2, -8)

scene.add(new THREE.AmbientLight(0xc8a96b, 0.4), new THREE.DirectionalLight(0xfff4d6, 1.6))

const face = new THREE.MeshStandardMaterial({ color: 0xc8a96b, roughness: 0.55 })
const box = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE)
for (const voxel of buildFactoryVoxels()) {
  const mesh = new THREE.Mesh(box, face)
  mesh.position.set(voxel.x, voxel.y, voxel.z)
  scene.add(mesh)
}

const zero = { x: -CUBE_SPACING / 2, y: 0, z: 0 }
const start = { x: 5.8, y: 5.2, z: 2.55 }
const plan = planCruiseStage(zero)
const { points, align } = buildDepartureWaypoints(start, zero, plan)
const curve = new THREE.CatmullRomCurve3(
  points.slice(0, points.length - align.points.length + 1).map((p) => new THREE.Vector3(p.x, p.y, p.z)),
  false,
  'centripetal',
)
const approach = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(curve.getSpacedPoints(160)),
  new THREE.LineBasicMaterial({ color: 0xc8a96b }),
)
const turn = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(align.points.map((p) => new THREE.Vector3(p.x, p.y, p.z))),
  new THREE.LineBasicMaterial({ color: 0xefe6cf }),
)
const marker = new THREE.Mesh(new THREE.SphereGeometry(0.12), new THREE.MeshBasicMaterial({ color: 0xffe7a3 }))
scene.add(approach, turn, marker)

const portal = new THREE.Mesh(
  new THREE.TorusGeometry(1.2, 0.08, 12, 48),
  new THREE.MeshBasicMaterial({ color: 0xc8a96b }),
)
portal.position.set(plan.portal.x, plan.portal.y, plan.portal.z)
scene.add(portal)

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

const approachLen = curve.getLength()
const total = approachLen + align.length
const tick = (time: number) => {
  const u = flightEase((time / 1000 / 8.8) % 1)
  const along = u * total
  if (along <= approachLen) curve.getPointAt(along / approachLen, marker.position)
  else {
    const sample = align.sample(along - approachLen)
    marker.position.set(sample.point.x, sample.point.y, sample.point.z)
  }
  controls.update()
  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
