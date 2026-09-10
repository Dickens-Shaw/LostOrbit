import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createPortalTransit } from '../../src/transit/portalTransit'

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
document.body.append(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 80)
camera.position.set(0, 1.4, 8)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true

scene.add(new THREE.AmbientLight(0xc8a96b, 0.45), new THREE.DirectionalLight(0xfff4d6, 1.8))

const portal = new THREE.Group()
const ring = new THREE.Mesh(
  new THREE.TorusGeometry(1.18, 0.06, 16, 64),
  new THREE.MeshBasicMaterial({ color: 0xc8a96b }),
)
portal.add(ring)
scene.add(portal)

const glowCanvas = document.createElement('canvas')
glowCanvas.width = glowCanvas.height = 64
const glowCtx = glowCanvas.getContext('2d')
if (glowCtx) {
  const wash = glowCtx.createRadialGradient(32, 32, 2, 32, 32, 30)
  wash.addColorStop(0, 'rgba(255,255,255,1)')
  wash.addColorStop(1, 'rgba(255,255,255,0)')
  glowCtx.fillStyle = wash
  glowCtx.fillRect(0, 0, 64, 64)
}
const glowMap = new THREE.CanvasTexture(glowCanvas)

const transit = createPortalTransit({
  portal,
  camera,
  glowMap,
  makeMaterials: () => ({
    hull: new THREE.MeshStandardMaterial({ color: 0xb9b3a6, roughness: 0.45 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xc8a96b, roughness: 0.35 }),
    glow: new THREE.MeshBasicMaterial({ color: 0xefe6cf }),
  }),
})

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

const clock = new THREE.Clock()
const tick = () => {
  transit.tick(Math.min(clock.getDelta(), 0.1), true, false)
  controls.update()
  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
