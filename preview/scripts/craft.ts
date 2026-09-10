import * as THREE from 'three'
import { buildFighter, buildFreighter } from '../../src/craft/craftModels'

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
document.body.append(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 40)
camera.position.set(3.2, 1.6, 6.4)
camera.lookAt(0, 0, 0)

const light = new THREE.DirectionalLight(0xfff4d6, 2.2)
light.position.set(4, 6, 8)
scene.add(light, new THREE.AmbientLight(0xc8a96b, 0.35))

const hull = new THREE.MeshStandardMaterial({ color: 0xb9b3a6, roughness: 0.45, metalness: 0.2 })
const trim = new THREE.MeshStandardMaterial({ color: 0xc8a96b, roughness: 0.35, metalness: 0.4 })
const glow = new THREE.MeshBasicMaterial({ color: 0xefe6cf })

const fighter = new THREE.Group()
buildFighter(fighter, { hull, trim, glow })
fighter.position.set(-1.6, 0, 0)
const freighter = new THREE.Group()
buildFreighter(freighter, { hull: hull.clone(), trim: trim.clone(), glow: glow.clone() })
freighter.position.set(1.8, 0, 0)
scene.add(fighter, freighter)

const onResize = () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
}
window.addEventListener('resize', onResize)

const tick = (time: number) => {
  fighter.rotation.y = time * 0.0004
  freighter.rotation.y = -time * 0.0003
  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
