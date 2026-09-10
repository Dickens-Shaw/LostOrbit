import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildFactoryVoxels, CUBE_SIZE, planFactoryFrame } from '../../src/layout/absentFactoryLayout'

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
document.body.append(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 80)
const frame = planFactoryFrame(innerWidth, innerHeight)
camera.position.set(0, 0, frame.distance)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true

const light = new THREE.DirectionalLight(0xfff4d6, 2)
light.position.set(6, 8, 10)
scene.add(light, new THREE.AmbientLight(0xc8a96b, 0.3))

const face = new THREE.MeshStandardMaterial({ color: 0xc8a96b, roughness: 0.55 })
const side = new THREE.MeshStandardMaterial({ color: 0x8f7a45, roughness: 0.6 })
const box = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE)
for (const voxel of buildFactoryVoxels()) {
  const mesh = new THREE.Mesh(box, voxel.layer === 0 ? face : side)
  mesh.position.set(voxel.x, voxel.y, voxel.z)
  scene.add(mesh)
}

window.addEventListener('resize', () => {
  const next = planFactoryFrame(innerWidth, innerHeight)
  camera.aspect = innerWidth / innerHeight
  camera.position.z = next.distance
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

const tick = () => {
  controls.update()
  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
