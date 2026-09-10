import { mountGridRunners } from '../../src/runners/gridRunnersMount'

const host = document.querySelector('#app')
if (!host) throw new Error('missing #app')
mountGridRunners(host as HTMLElement)
