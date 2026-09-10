import { mountLostOrbit } from '../../src/scene/mountLostOrbit'

const host = document.querySelector('#app')
if (!host) throw new Error('missing #app')

mountLostOrbit(host as HTMLElement, {
  stationLabel: 'Home',
  onStation: () => {
    window.location.href = './index.html'
  },
})
