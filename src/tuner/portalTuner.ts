export type PortalTilt = {
  x: number
  y: number
  z: number
  hoverX: number
  hoverY: number
  hoverZ: number
}

export type PortalTunerLive = {
  rotX: number
  rotY: number
  rotZ: number
  hover: number
  stationX: number
  stationY: number
}

export type PortalTunerHandle = {
  tilt: PortalTilt
  forceHover: boolean
  freezeWobble: boolean
  pinStation: boolean
  stationX: number
  stationY: number
  update(live: PortalTunerLive): void
  dispose(): void
}

const STORAGE_KEY = 'lp-portal-tilt'
const RANGE = { min: -Math.PI, max: Math.PI, step: 0.01 }

const SLIDERS: { key: keyof PortalTilt; label: string }[] = [
  { key: 'x', label: '静止 X' },
  { key: 'y', label: '静止 Y 压扁' },
  { key: 'z', label: '静止 Z 斜轴' },
  { key: 'hoverX', label: '悬停 X' },
  { key: 'hoverY', label: '悬停 Y' },
  { key: 'hoverZ', label: '悬停 Z' },
]

function deg(rad: number): string {
  return `${((rad * 180) / Math.PI).toFixed(1)}°`
}

function radText(rad: number): string {
  return rad.toFixed(3)
}

function snippetOf(tilt: PortalTilt): string {
  const n = (value: number) => Number(value.toFixed(3))
  return `const PORTAL_TILT = { x: ${n(tilt.x)}, y: ${n(tilt.y)}, z: ${n(tilt.z)}, hoverX: ${n(tilt.hoverX)}, hoverY: ${n(tilt.hoverY)}, hoverZ: ${n(tilt.hoverZ)} }`
}

function readStored(): Partial<PortalTilt> | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PortalTilt>
    return parsed
  } catch {
    return null
  }
}

function writeStored(tilt: PortalTilt) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tilt))
  } catch {
    /* ignore quota / private mode */
  }
}

/** 调参面板已收起。要对门时在地址后加 ?portalDebug=1。 */
export function shouldMountPortalTuner(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return new URLSearchParams(window.location.search).has('portalDebug')
  } catch {
    return false
  }
}

export function mountPortalTuner(defaults: PortalTilt, station: { x: number; y: number }): PortalTunerHandle {
  const stored = readStored()
  const tilt: PortalTilt = {
    x: stored?.x ?? defaults.x,
    y: stored?.y ?? defaults.y,
    z: stored?.z ?? defaults.z,
    hoverX: stored?.hoverX ?? defaults.hoverX,
    hoverY: stored?.hoverY ?? defaults.hoverY,
    hoverZ: stored?.hoverZ ?? defaults.hoverZ,
  }

  const handle: PortalTunerHandle = {
    tilt,
    forceHover: false,
    freezeWobble: true,
    pinStation: false,
    stationX: station.x,
    stationY: station.y,
    update() {},
    dispose() {},
  }

  const root = document.createElement('aside')
  root.className = 'portal-tuner'
  root.dataset.testid = 'portal-tuner'
  root.innerHTML = `
    <header class="portal-tuner-head">
      <strong>传送门参数</strong>
      <span>YXZ · 弧度</span>
      <button type="button" data-act="fold" aria-expanded="true">收起</button>
    </header>
    <div class="portal-tuner-body">
      <dl class="portal-tuner-live">
        <div><dt>当前 X</dt><dd data-live="rotX">0</dd></div>
        <div><dt>当前 Y</dt><dd data-live="rotY">0</dd></div>
        <div><dt>当前 Z</dt><dd data-live="rotZ">0</dd></div>
        <div><dt>hover</dt><dd data-live="hover">0</dd></div>
        <div class="portal-tuner-live-wide"><dt>门位</dt><dd data-live="station">0, 0</dd></div>
      </dl>
      <div class="portal-tuner-sliders"></div>
      <label class="portal-tuner-row">
        <span>门位 X</span>
        <input type="range" min="-12" max="-2" step="0.05" data-station="x" />
        <output data-station-out="x">0</output>
      </label>
      <label class="portal-tuner-row">
        <span>门位 Y</span>
        <input type="range" min="0.5" max="7" step="0.05" data-station="y" />
        <output data-station-out="y">0</output>
      </label>
      <div class="portal-tuner-flags">
        <label><input type="checkbox" data-flag="forceHover" /> 锁定悬停</label>
        <label><input type="checkbox" data-flag="freezeWobble" checked /> 关掉晃动</label>
      </div>
      <div class="portal-tuner-actions">
        <button type="button" data-act="copy">复制常量</button>
        <button type="button" data-act="reset">重置</button>
      </div>
      <pre class="portal-tuner-code" data-code></pre>
    </div>
  `

  const sliderHost = root.querySelector('.portal-tuner-sliders')!
  const inputs = new Map<keyof PortalTilt, HTMLInputElement>()
  const outputs = new Map<keyof PortalTilt, HTMLOutputElement>()

  for (const item of SLIDERS) {
    const row = document.createElement('label')
    row.className = 'portal-tuner-row'
    row.innerHTML = `
      <span>${item.label}</span>
      <input type="range" min="${RANGE.min}" max="${RANGE.max}" step="${RANGE.step}" data-key="${item.key}" />
      <output></output>
    `
    const input = row.querySelector('input')!
    const output = row.querySelector('output')!
    inputs.set(item.key, input)
    outputs.set(item.key, output)
    sliderHost.append(row)
  }

  const stationInputs = {
    x: root.querySelector<HTMLInputElement>('input[data-station="x"]')!,
    y: root.querySelector<HTMLInputElement>('input[data-station="y"]')!,
  }
  const stationOuts = {
    x: root.querySelector<HTMLOutputElement>('output[data-station-out="x"]')!,
    y: root.querySelector<HTMLOutputElement>('output[data-station-out="y"]')!,
  }
  const liveEls = {
    rotX: root.querySelector<HTMLElement>('[data-live="rotX"]')!,
    rotY: root.querySelector<HTMLElement>('[data-live="rotY"]')!,
    rotZ: root.querySelector<HTMLElement>('[data-live="rotZ"]')!,
    hover: root.querySelector<HTMLElement>('[data-live="hover"]')!,
    station: root.querySelector<HTMLElement>('[data-live="station"]')!,
  }
  const codeEl = root.querySelector<HTMLElement>('[data-code]')!
  const foldBtn = root.querySelector<HTMLButtonElement>('[data-act="fold"]')!

  const paintTilt = () => {
    for (const item of SLIDERS) {
      const value = tilt[item.key]
      inputs.get(item.key)!.value = String(value)
      outputs.get(item.key)!.textContent = `${radText(value)}  ${deg(value)}`
    }
    codeEl.textContent = snippetOf(tilt)
    writeStored(tilt)
  }

  const paintStation = () => {
    stationInputs.x.value = String(handle.stationX)
    stationInputs.y.value = String(handle.stationY)
    stationOuts.x.textContent = handle.stationX.toFixed(2)
    stationOuts.y.textContent = handle.stationY.toFixed(2)
  }

  paintTilt()
  paintStation()

  sliderHost.addEventListener('input', (event) => {
    const input = event.target
    if (!(input instanceof HTMLInputElement)) return
    const key = input.dataset.key as keyof PortalTilt | undefined
    if (!key) return
    tilt[key] = Number(input.value)
    paintTilt()
  })

  root.querySelector('.portal-tuner-body')!.addEventListener('input', (event) => {
    const input = event.target
    if (!(input instanceof HTMLInputElement)) return
    if (input.dataset.station === 'x') {
      handle.pinStation = true
      handle.stationX = Number(input.value)
      paintStation()
    }
    if (input.dataset.station === 'y') {
      handle.pinStation = true
      handle.stationY = Number(input.value)
      paintStation()
    }
    if (input.dataset.flag === 'forceHover') handle.forceHover = input.checked
    if (input.dataset.flag === 'freezeWobble') handle.freezeWobble = input.checked
  })

  root.querySelector('[data-act="copy"]')!.addEventListener('click', async () => {
    const text = snippetOf(tilt)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      window.prompt('复制这段常量', text)
    }
  })

  root.querySelector('[data-act="reset"]')!.addEventListener('click', () => {
    Object.assign(tilt, defaults)
    handle.pinStation = false
    handle.stationX = station.x
    handle.stationY = station.y
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    paintTilt()
    paintStation()
  })

  foldBtn.addEventListener('click', () => {
    const folded = root.classList.toggle('is-folded')
    foldBtn.textContent = folded ? '展开' : '收起'
    foldBtn.setAttribute('aria-expanded', folded ? 'false' : 'true')
  })

  handle.update = (live) => {
    liveEls.rotX.textContent = `${radText(live.rotX)}  ${deg(live.rotX)}`
    liveEls.rotY.textContent = `${radText(live.rotY)}  ${deg(live.rotY)}`
    liveEls.rotZ.textContent = `${radText(live.rotZ)}  ${deg(live.rotZ)}`
    liveEls.hover.textContent = live.hover.toFixed(2)
    liveEls.station.textContent = `${live.stationX.toFixed(2)}, ${live.stationY.toFixed(2)}`
    if (!handle.pinStation) {
      handle.stationX = live.stationX
      handle.stationY = live.stationY
      paintStation()
    }
  }

  handle.dispose = () => {
    root.remove()
  }

  document.body.append(root)
  return handle
}
