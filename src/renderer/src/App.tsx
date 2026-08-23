import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from '@heroui/react'
import {
  api, ALL_MONITORS, type Settings, type DisplayInfo, type WindowInfo,
  type NetDevice, type FoundDevice, type UpdateState,
} from './api'
import { Panel, Button, Field, Input, Toggle, Tag } from './components/brutal'
import { BrutalSelect, HelpModal, type Option } from './components/hero'

const ENCODERS: Option[] = [
  { key: 'auto', label: 'Auto (recommended)' },
  { key: 'h264_nvenc', label: 'NVIDIA GPU (NVENC)' },
  { key: 'h264_qsv', label: 'Intel GPU (Quick Sync)' },
  { key: 'h264_amf', label: 'AMD GPU (AMF)' },
  { key: 'cpu', label: 'CPU only (software)' },
]

const CAPTURES: Option[] = [
  { key: 'auto', label: 'Auto (recommended)' },
  { key: 'ddagrab', label: 'Desktop Duplication (GPU)' },
  { key: 'gdigrab', label: 'GDI (most compatible)' },
]

const CAPTURE_TARGETS: Option[] = [
  { key: 'screen', label: 'Screen / monitor' },
  { key: 'window', label: 'One application window' },
]

const WINDOW_CAPTURE: Option[] = [
  { key: 'gdigrab', label: 'GDI (required for app windows)' },
]

const OUTPUTS: Option[] = [
  { key: 'udp', label: 'UDP — VLC / Android receiver' },
  { key: 'hls', label: 'HLS — LG TV web browser' },
]

const LATENCY_MODES: Option[] = [
  { key: 'smooth', label: 'Smooth low latency (recommended)' },
  { key: 'compatibility', label: 'Compatibility (older TVs)' },
]

const PRESETS = [
  { label: '1080p60', width: '1920', fps: '60', bitrate: '8000' },
  { label: '1080p30', width: '1920', fps: '30', bitrate: '6000' },
  { label: '720p60', width: '1280', fps: '60', bitrate: '4000' },
]

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [windows, setWindows] = useState<WindowInfo[]>([])
  const [audioDevices, setAudioDevices] = useState<string[]>([])
  const [audioRaw, setAudioRaw] = useState('')
  const [log, setLog] = useState<string[]>([])
  const [streaming, setStreaming] = useState(false)
  const [status, setStatus] = useState('Idle')
  const [busy, setBusy] = useState<string | null>(null)
  const [found, setFound] = useState<FoundDevice[] | null>(null)
  const [netDevices, setNetDevices] = useState<NetDevice[] | null>(null)
  const [netListOpen, setNetListOpen] = useState(false)
  const [extraDisplayOpen, setExtraDisplayOpen] = useState(false)
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null)
  const [netFilter, setNetFilter] = useState('')
  const [ffmpegInfo, setFfmpegInfo] = useState<{ ok: boolean; version: string; path: string } | null>(null)
  const [localIp, setLocalIp] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const addLog = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-600), line])
  }, [])

  useEffect(() => {
    api.loadSettings().then(setSettings)
    api.listDisplays().then(setDisplays)
    api.listWindows().then(setWindows)
    api.probeFfmpeg().then(setFfmpegInfo)
    api.updateStatus().then(setUpdate)
    const offLog = api.onLog(addLog)
    const offEnd = api.onEnded((code) => {
      setStreaming(false)
      setStatus('Idle')
      addLog(`ffmpeg exited (code ${code}).`)
    })
    const offScan = api.onScanProgress(setScanProgress)
    const offUpdate = api.onUpdateStatus(setUpdate)
    return () => { offLog(); offEnd(); offScan(); offUpdate() }
  }, [addLog])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [log])

  useEffect(() => {
    let cancelled = false
    const targetIp = settings?.tvIp.trim()
    if (!targetIp) {
      setLocalIp(null)
      return
    }
    api.getLocalIp(targetIp).then((ip) => {
      if (!cancelled) setLocalIp(ip)
    }).catch(() => {
      if (!cancelled) setLocalIp(null)
    })
    return () => { cancelled = true }
  }, [settings?.tvIp])

  if (!settings) {
    return (
      <div className="grid h-full place-items-center">
        <span className="loading-plaque">Warming up receiver…</span>
      </div>
    )
  }

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((s) => (s ? { ...s, [key]: value } : s))

  const monitorOptions: Option[] = [
    { key: ALL_MONITORS, label: ALL_MONITORS },
    ...displays.map((d) => ({ key: d.label, label: d.label })),
  ]
  const selectedMonitorKey = monitorOptions.some((o) => o.key === settings.monitorLabel)
    ? settings.monitorLabel
    : ALL_MONITORS

  const windowOptions: Option[] = windows.map((window) => ({
    key: window.id,
    label: window.title,
  }))
  const selectedWindow = windows.find((window) => window.handle === settings.windowHandle)
    ?? windows.find((window) => window.title === settings.windowTitle)
  const selectedWindowKey = selectedWindow?.id ?? ''
  const isWindowCapture = settings.captureTarget === 'window'

  const isHls = settings.outputMode === 'hls'
  const hlsBase = localIp ? `http://${localIp}:${settings.hlsPort || '8090'}` : ''
  const tvBrowserUrl = hlsBase ? `${hlsBase}/tv` : ''
  const receiverUrl = isHls ? tvBrowserUrl : `udp://@:${settings.tvPort || '1234'}`
  const filteredNetDevices = (netDevices ?? []).filter((device) => {
    const query = netFilter.trim().toLowerCase()
    return !query || device.ip.includes(query) || device.mac.toLowerCase().includes(query)
  })

  const applyPreset = (p: typeof PRESETS[number]) => {
    set('scaleWidth', p.width); set('fps', p.fps); set('bitrateKbps', p.bitrate)
    addLog(`Preset applied: ${p.width}px wide, ${p.fps}fps, ${p.bitrate}kbps.`)
  }

  const chooseWindow = (sourceId: string) => {
    const chosen = windows.find((window) => window.id === sourceId)
    if (!chosen) return
    setSettings((current) => current ? {
      ...current,
      windowHandle: chosen.handle,
      windowTitle: chosen.title,
    } : current)
  }

  const withBusy = async (name: string, fn: () => Promise<void>) => {
    setBusy(name)
    try { await fn() } finally { setBusy(null) }
  }

  const start = async () => {
    const chosen = displays.find((d) => d.label === selectedMonitorKey)
    if (isWindowCapture && !selectedWindow) {
      setStatus('Error')
      addLog('Choose an open application window before starting.')
      return
    }
    const effectiveSettings = selectedWindow ? {
      ...settings,
      windowHandle: selectedWindow.handle,
      windowTitle: selectedWindow.title,
    } : settings
    setStatus('Starting…')
    const res = await api.startStream({
      settings: effectiveSettings,
      monitor: !isWindowCapture && chosen ? chosen.rect : null,
      monitorIndex: !isWindowCapture && chosen ? chosen.index : 0,
      windowSourceId: isWindowCapture ? selectedWindow?.id : null,
      windowTitle: isWindowCapture ? selectedWindow?.title : null,
    })
    if (!res.ok) {
      setStatus('Error')
      addLog(res.error ?? 'Could not start.')
      return
    }
    await api.saveSettings(effectiveSettings)
    setSettings(effectiveSettings)
    setStreaming(true)
    setStatus(`Streaming — ${res.encoder} · ${res.capture} · ${settings.outputMode.toUpperCase()}`)
    if (res.tvUrl) addLog(`Open this address in the LG TV web browser: ${res.tvUrl}`)
  }

  const stop = async () => { await api.stopStream(); setStreaming(false); setStatus('Idle') }

  const openWirelessDisplayPicker = async () => {
    const result = await api.openWirelessDisplayPicker()
    if (!result.ok) {
      setStatus('Wireless display unavailable')
      addLog(result.error ?? 'Windows could not open the wireless display picker.')
      return
    }
    setStatus('Choose the TV in Windows, then use Extend mode')
    addLog('Windows wireless display picker opened. Select the TV and approve it on the TV screen.')
  }

  const useExtendMode = async () => {
    const result = await api.useExtendMode()
    if (!result.ok) {
      setStatus('Extend mode unavailable')
      addLog(result.error ?? 'Windows could not enable Extend mode.')
      return
    }
    setStatus('Extra monitor enabled')
    addLog('Windows switched connected displays to Extend mode.')
    setExtraDisplayOpen(false)
    window.setTimeout(() => { void api.listDisplays().then(setDisplays) }, 1500)
  }

  const installUpdate = async () => {
    if (streaming) {
      addLog('Stopping the stream before updating LANCAST…')
      await stop()
    }
    addLog(`Downloading LANCAST ${update?.version ? `v${update.version}` : 'update'}…`)
    const result = await api.installUpdate()
    if (!result.ok) addLog(result.error ?? 'The update could not be started.')
  }

  const showUpdate = update && ['available', 'downloading', 'installing', 'error'].includes(update.phase)
  const updateLabel = update?.phase === 'downloading'
    ? `DOWNLOADING ${Math.round(update.percent ?? 0)}%`
    : update?.phase === 'installing'
      ? 'INSTALLING…'
      : update?.phase === 'error'
        ? 'RETRY UPDATE'
        : `UPDATE TO v${update?.version}`

  return (
    <div className="app-shell flex flex-col text-ink">
      {/* Header */}
      <header className="app-toolbar flex items-center justify-between">
        <div className="brand-lockup">
          <div className="brand-badge">
            <h1 className="brand-title">LANCAST</h1>
          </div>
          <div className="flex flex-col gap-1">
            <span className="brand-subtitle">Desktop → TV · local network only</span>
            <span className="hardware-label">Network AV transmitter · Model NC-120</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {showUpdate && (
            <Button
              size="sm"
              variant="primary"
              className="update-button"
              disabled={update.phase === 'downloading' || update.phase === 'installing'}
              title={update.message ?? 'Download, restart, and install the latest LANCAST release'}
              onClick={installUpdate}
            >
              {updateLabel}
            </Button>
          )}
          {streaming ? <Tag tone="live">LIVE</Tag> : <Tag>IDLE</Tag>}
          {ffmpegInfo && (
            <Tag tone={ffmpegInfo.ok ? 'good' : 'bad'}>
              {ffmpegInfo.ok ? 'FFMPEG OK' : 'NO FFMPEG'}
            </Tag>
          )}
        </div>
      </header>

      <main className="receiver-deck grid flex-1 gap-4 overflow-auto p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ------------------------------------------------ destination -- */}
        <Panel title="01 · Destination" className="destination-panel">
          <div className="flex flex-col gap-3">
            <Field label="Receiver type">
              <BrutalSelect ariaLabel="Receiver type" options={OUTPUTS}
                value={settings.outputMode} onChange={(k) => set('outputMode', k as Settings['outputMode'])} />
            </Field>

            <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
              <Field label="TV IP address">
                <Input value={settings.tvIp} onChange={(e) => set('tvIp', e.target.value)}
                       placeholder="192.168.1.50" />
              </Field>
              <Button size="sm" disabled={!!busy} onClick={() => withBusy('scan', async () => {
                addLog('Searching the local network for TVs…')
                const devs = await api.discover()
                setFound(devs)
                addLog(`Discovery finished: ${devs.length} device(s) replied.`)
              })}>{busy === 'scan' ? '…' : 'Find TV'}</Button>
              <Button size="sm" disabled={!!busy} onClick={() => withBusy('net', async () => {
                setNetDevices(null); setNetListOpen(false); setNetFilter('')
                setScanProgress({ done: 0, total: 254 })
                addLog('Scanning the local subnet…')
                const devs = await api.scanNetwork()
                setNetDevices(devs); setNetListOpen(true); setScanProgress(null)
                addLog(`Scan finished: ${devs.length} device(s) found.`)
              })}>{busy === 'net' ? '…' : 'All devices'}</Button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label={isHls ? 'HTTP port on this PC' : 'UDP port'}>
                <Input value={isHls ? settings.hlsPort : settings.tvPort}
                  onChange={(e) => isHls ? set('hlsPort', e.target.value) : set('tvPort', e.target.value)} />
              </Field>
              <Field label={isHls ? 'Open this in the LG web browser' : 'On the TV, open this in VLC'}>
                <div className="flex gap-1">
                  <Input readOnly value={receiverUrl}
                    placeholder={isHls ? 'Enter a valid TV IP first' : undefined}
                  />
                  <Button size="sm" disabled={!receiverUrl}
                    onClick={() => { api.copy(receiverUrl); addLog('Receiver URL copied.') }}>Copy</Button>
                </div>
              </Field>
            </div>

            <Field label="Transmission latency">
              <BrutalSelect ariaLabel="Transmission latency" options={LATENCY_MODES}
                value={settings.latencyMode}
                onChange={(k) => set('latencyMode', k as Settings['latencyMode'])} />
            </Field>
            <div className={`latency-profile-readout ${settings.latencyMode === 'smooth' ? 'is-smooth' : ''}`}>
              <span className="latency-profile-led" aria-hidden />
              <div>
                <strong>{settings.latencyMode === 'smooth' ? 'LOW DELAY · SMOOTH GUARD' : 'COMPATIBILITY BUFFER'}</strong>
                <small>{settings.latencyMode === 'smooth'
                  ? (isHls
                    ? 'TV-safe 1 s segments · 3 s safety buffer · live-edge recovery'
                    : 'Immediate packet flush · anti-burst socket buffer · fast keyframe recovery')
                  : 'Use this only if an older receiver stalls or refuses the smooth profile.'}</small>
              </div>
            </div>

            {isHls && (
              <div className="info-well p-3 text-[11px] leading-snug">
                <strong>No TV app required:</strong> press Start, open the LG TV’s Web Browser,
                enter the address above, then choose <strong>Play stream</strong> and <strong>Fullscreen</strong>.
                Allow LANCAST through Windows Firewall on <strong>Private networks</strong> when prompted.
              </div>
            )}

            {found && (
              <div className="device-list">
                <div className="device-list-header">
                  Replied to discovery — {found.length}
                </div>
                <div className="max-h-40 overflow-auto">
                  {found.length === 0 && (
                    <p className="p-2 text-[11px]">
                      Nothing replied. Not every TV announces itself — use “All devices”, or read the
                      IP from the TV’s network settings.
                    </p>
                  )}
                  {found.map((d) => (
                    <button key={d.ip} onClick={() => { set('tvIp', d.ip); setFound(null) }}
                      className="device-row flex w-full items-center justify-between gap-2 px-2 py-1 text-left">
                      <span className="font-mono text-[12px] font-bold">{d.ip}</span>
                      <span className="truncate text-[10px] opacity-70">{d.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {scanProgress && (
              <div className="info-well progress-well">
                <div className="section-label mb-1">
                  Pinging subnet — {scanProgress.done}/{scanProgress.total}
                </div>
                <div className="progress-track">
                  <div className="progress-fill"
                       style={{ width: `${(scanProgress.done / scanProgress.total) * 100}%` }} />
                </div>
              </div>
            )}

            {netDevices && (
              <>
                <button
                  type="button"
                  className="device-results-launch"
                  onClick={() => setNetListOpen(true)}
                >
                  <span className="device-results-launch-led" aria-hidden />
                  <span>
                    <strong>{netDevices.length} network device(s) ready</strong>
                    <small>Open the IP / MAC results popup</small>
                  </span>
                  <span className="device-results-launch-arrow" aria-hidden>OPEN ↗</span>
                </button>

                <Modal isOpen={netListOpen} onOpenChange={setNetListOpen}>
                  <Modal.Backdrop className="skeuo-modal-backdrop" isDismissable>
                    <Modal.Container placement="center">
                      <Modal.Dialog className="skeuo-modal skeuo-device-modal">
                        <Modal.Header className="skeuo-modal-header">
                          <Modal.Heading className="skeuo-modal-title">
                            Network devices · choose the TV
                          </Modal.Heading>
                          <Modal.CloseTrigger className="skeuo-modal-close" />
                        </Modal.Header>
                        <Modal.Body className="skeuo-modal-body device-modal-body">
                          <div className="device-modal-intro">
                            <div>
                              <strong>Choose one device to fill the TV IP address.</strong>
                              <span>The popup closes automatically after your choice.</span>
                            </div>
                            <span className="device-modal-count">
                              {filteredNetDevices.length} / {netDevices.length} shown
                            </span>
                          </div>
                          <label className="device-picker-filter">
                            <span>Filter the list</span>
                            <input
                              autoFocus
                              value={netFilter}
                              onChange={(e) => setNetFilter(e.target.value)}
                              placeholder="Type an IP or MAC address"
                              className="mini-input"
                            />
                          </label>
                          <div className="device-column-head" aria-hidden>
                            <span>IP address</span>
                            <span>MAC address</span>
                          </div>
                          <div className="device-picker-results" role="listbox" aria-label="Network devices">
                            {filteredNetDevices.length === 0 && (
                              <p className="device-picker-empty">
                                {netDevices.length === 0
                                  ? 'No devices answered the scan. Check the router or enter the TV IP manually.'
                                  : 'No IP or MAC address matches this filter.'}
                              </p>
                            )}
                            {filteredNetDevices.map((device) => (
                              <button
                                key={device.ip}
                                type="button"
                                role="option"
                                aria-selected={device.ip === settings.tvIp.trim()}
                                onClick={() => {
                                  set('tvIp', device.ip)
                                  setNetListOpen(false)
                                  addLog(`Selected network device ${device.ip} (${device.mac}).`)
                                }}
                                className={`device-row ${device.ip === settings.tvIp.trim() ? 'is-selected' : ''}`}
                              >
                                <span className="device-ip">{device.ip}</span>
                                <span className="device-mac">{device.mac || 'MAC unavailable'}</span>
                              </button>
                            ))}
                          </div>
                        </Modal.Body>
                        <Modal.Footer className="device-modal-footer">
                          <span>Select a row, or close without changing the current IP.</span>
                          <Modal.CloseTrigger className="skeuo-button skeuo-button-md">
                            Close
                          </Modal.CloseTrigger>
                        </Modal.Footer>
                      </Modal.Dialog>
                    </Modal.Container>
                  </Modal.Backdrop>
                </Modal>
              </>
            )}
          </div>
        </Panel>

        {/* ----------------------------------------------------- picture -- */}
        <Panel title="02 · Picture" className="picture-panel">
          <div className="flex flex-col gap-3">
            <Field label="What to stream">
              <BrutalSelect ariaLabel="What to stream" options={CAPTURE_TARGETS}
                value={settings.captureTarget}
                onChange={(key) => set('captureTarget', key as Settings['captureTarget'])} />
            </Field>

            {!isWindowCapture ? <Field label="Screen to stream">
              <div className="flex gap-1">
                <BrutalSelect ariaLabel="Screen to stream" options={monitorOptions}
                  value={selectedMonitorKey} onChange={(k) => set('monitorLabel', k)} />
                <Button size="sm" onClick={async () => {
                  const d = await api.listDisplays(); setDisplays(d)
                  addLog(`Detected ${d.length} monitor(s).`)
                }}>Refresh</Button>
              </div>
            </Field> : <>
              <Field label="Application window">
                <div className="flex gap-1">
                  <BrutalSelect ariaLabel="Application window" options={windowOptions}
                    value={selectedWindowKey} onChange={chooseWindow} />
                  <Button size="sm" onClick={async () => {
                    const foundWindows = await api.listWindows(); setWindows(foundWindows)
                    addLog(`Detected ${foundWindows.length} open application window(s).`)
                  }}>Refresh</Button>
                </div>
              </Field>
              <div className="info-well p-3 text-[11px] leading-snug">
                Only this top-level window is sent to the TV, even when it moves. Keep it open and
                not minimized while streaming. Menus, dialogs, and other windows opened by the same
                app are separate and are not included automatically.
              </div>
            </>}

            <div>
              <span className="section-label">Quality preset</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <Button key={p.label} size="sm" onClick={() => applyPreset(p)}>{p.label}</Button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Field label="Width"><Input value={settings.scaleWidth} onChange={(e) => set('scaleWidth', e.target.value)} /></Field>
              <Field label="FPS"><Input value={settings.fps} onChange={(e) => set('fps', e.target.value)} /></Field>
              <Field label="Bitrate kbps"><Input value={settings.bitrateKbps} onChange={(e) => set('bitrateKbps', e.target.value)} /></Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Encoder">
                <BrutalSelect ariaLabel="Encoder" options={ENCODERS}
                  value={settings.encoderPref} onChange={(k) => set('encoderPref', k)} />
              </Field>
              <Field label="Capture method">
                <BrutalSelect ariaLabel="Capture method"
                  options={isWindowCapture ? WINDOW_CAPTURE : CAPTURES}
                  value={isWindowCapture ? 'gdigrab' : settings.captureMethod}
                  disabled={isWindowCapture}
                  onChange={(k) => set('captureMethod', k)} />
              </Field>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!!busy} onClick={() => withBusy('enc', async () => {
                const name = await api.detectEncoder(settings.ffmpegPath, settings.encoderPref)
                setStatus(`Idle — encoder: ${name}`)
              })}>{busy === 'enc' ? '…' : 'Test encoder'}</Button>
              <HelpModal title="Capture method"
                trigger={<Button size="sm" variant="ghost">Why is this slow?</Button>}>
                <p className="mb-2">
                  This is how the picture gets off your screen, and it matters more than anything
                  else for high frame rates.
                </p>
                <p className="mb-2">
                  <strong>GDI</strong> is the classic method. It works everywhere, but every frame is
                  copied through your CPU. At 1920×1080 that is about 8&nbsp;MB per frame — roughly
                  half a gigabyte every second at 60fps. That is why GDI struggles to hold 60fps, and
                  why it gets worse when your PC is also servicing a live audio device. Capturing one
                  application window uses GDI because Desktop Duplication only captures displays.
                </p>
                <p className="mb-2">
                  <strong>Desktop Duplication</strong> asks Windows for the finished frame straight
                  from the GPU. Your CPU barely participates, and with an NVIDIA GPU at your screen’s
                  native size the frame never leaves the graphics card at all — capture to encoder
                  with no round trip through system memory. This is what makes smooth 1080p60
                  realistic.
                </p>
                <p>
                  <strong>Auto</strong> tests Desktop Duplication when you press Start and uses it if
                  it works, falling back to GDI otherwise. It needs Windows 8+ and can be unavailable
                  in a remote desktop session, so the fallback matters. The log always says which one
                  was used.
                </p>
              </HelpModal>
            </div>
          </div>
        </Panel>

        {/* ------------------------------------------------------- sound -- */}
        <Panel title="03 · Sound">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Toggle checked={settings.includeAudio} label="Include audio"
                onChange={(v) => set('includeAudio', v)} />
              <Button size="sm" disabled={!!busy} onClick={() => withBusy('audio', async () => {
                const { devices, raw } = await api.listAudioDevices(settings.ffmpegPath)
                setAudioDevices(devices); setAudioRaw(raw)
                addLog(devices.length
                  ? `Found ${devices.length} audio device(s).`
                  : 'No audio devices found — see the audio help for how to add one.')
              })}>{busy === 'audio' ? '…' : 'Find devices'}</Button>
            </div>

            <Field label="Audio device">
              <BrutalSelect ariaLabel="Audio device" disabled={!settings.includeAudio}
                options={(audioDevices.length ? audioDevices : (settings.audioDevice ? [settings.audioDevice] : []))
                  .map((d) => ({ key: d, label: d }))}
                value={settings.audioDevice} onChange={(k) => set('audioDevice', k)} />
            </Field>

            <div className="grid grid-cols-[120px_1fr] items-end gap-2">
              <Field label="Sync (ms)">
                <Input value={settings.audioDelayMs} onChange={(e) => set('audioDelayMs', e.target.value)} />
              </Field>
              <div className="flex gap-2 pb-0.5">
                <HelpModal title="Audio sync"
                  trigger={<Button size="sm" variant="ghost">Out of step?</Button>}>
                  <p className="mb-2">
                    Work out which one is late first, because the sign depends on it. Watch something
                    with speech and see whether the mouth moves before you hear it, or the other way
                    round.
                  </p>
                  <p className="mb-2">
                    <strong>Sound arrives after the picture:</strong> use a <strong>negative</strong>
                    {' '}number, e.g. −200. This pulls audio earlier.
                  </p>
                  <p className="mb-2">
                    <strong>Sound arrives before the picture:</strong> use a <strong>positive</strong>
                    {' '}number, e.g. 200. This holds audio back.
                  </p>
                  <p className="mb-2">
                    Adjust by 100 until the gap closes, then by 25. If a change makes it clearly
                    worse, the sign is backwards.
                  </p>
                  <p>
                    The default of −112 is what one real TV measured out at. It is not universal —
                    it depends on how long a given TV buffers video before displaying it — so retune
                    it on different hardware. Restart the stream for a change to take effect.
                  </p>
                </HelpModal>
                <HelpModal title="One app only, or everything?"
                  trigger={<Button size="sm" variant="ghost">Audio setup</Button>}>
                  <p className="mb-2">
                    This captures audio from a <em>device</em>, not from an application, so there is
                    no “just give me this app’s sound” option on its own. A free virtual audio cable
                    plus Windows’ own per-app routing gets you either result.
                  </p>
                  <p className="mb-2">
                    <strong>Everything:</strong> install VB-Audio Virtual Cable, set “CABLE Input” as
                    your Windows default output, enable “Listen to this device” on it so you still
                    hear things, then pick “CABLE Output” here.
                  </p>
                  <p className="mb-2">
                    <strong>One app only:</strong> keep your normal speakers as default. In Settings →
                    System → Sound → Volume mixer, change just that app’s output to “CABLE Input”.
                    Pick “CABLE Output” here and only that app is captured.
                  </p>
                  <Button size="sm" onClick={() => api.openExternal('https://vb-audio.com/Cable/')}>
                    Get VB-Cable (free)
                  </Button>
                </HelpModal>
              </div>
            </div>

            {audioDevices.length === 0 && audioRaw && (
              <details className="details-well p-2">
                <summary className="section-label cursor-pointer">
                  No devices found — raw ffmpeg output
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto text-[10px] leading-tight whitespace-pre-wrap">
                  {audioRaw}
                </pre>
              </details>
            )}
          </div>
        </Panel>

        {/* --------------------------------------------------------- run -- */}
        <Panel title="04 · Run" accent="var(--color-acid)">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="lg" variant="primary" disabled={streaming} onClick={start}>
                ▶ Start
              </Button>
              <Button size="lg" variant="danger" disabled={!streaming} onClick={stop}>
                ■ Stop
              </Button>
              <Button
                size="lg"
                className="extra-display-launch"
                onClick={() => setExtraDisplayOpen(true)}
              >
                ▣ Add as extra monitor
              </Button>
            </div>

            <Modal isOpen={extraDisplayOpen} onOpenChange={setExtraDisplayOpen}>
              <Modal.Backdrop className="skeuo-modal-backdrop" isDismissable>
                <Modal.Container placement="center">
                  <Modal.Dialog className="skeuo-modal skeuo-extra-display-modal">
                    <Modal.Header className="skeuo-modal-header">
                      <Modal.Heading className="skeuo-modal-title">
                        Add the TV as an extra monitor
                      </Modal.Heading>
                      <Modal.CloseTrigger className="skeuo-modal-close" />
                    </Modal.Header>
                    <Modal.Body className="skeuo-modal-body extra-display-modal-body">
                      <div className="extra-display-intro">
                        <span className="extra-display-screen" aria-hidden>▣</span>
                        <div>
                          <strong>Windows Wireless Display</strong>
                          <span>This uses Miracast, not the LANCAST browser stream.</span>
                        </div>
                      </div>

                      <ol className="extra-display-steps">
                        <li>
                          <span>1</span>
                          <div><strong>Open the TV picker</strong><small>Select your LG or Samsung TV in Windows.</small></div>
                        </li>
                        <li>
                          <span>2</span>
                          <div><strong>Approve on the TV</strong><small>Accept the wireless display request with the TV remote.</small></div>
                        </li>
                        <li>
                          <span>3</span>
                          <div><strong>Enable Extend</strong><small>Return here and press the second button below.</small></div>
                        </li>
                      </ol>

                      <div className="extra-display-actions">
                        <Button
                          size="lg"
                          variant="primary"
                          disabled={!!busy}
                          onClick={() => withBusy('wireless-display', openWirelessDisplayPicker)}
                        >
                          {busy === 'wireless-display' ? 'OPENING…' : '1 · OPEN TV PICKER'}
                        </Button>
                        <Button
                          size="lg"
                          disabled={!!busy}
                          onClick={() => withBusy('extend-display', useExtendMode)}
                        >
                          {busy === 'extend-display' ? 'SWITCHING…' : '2 · TV CONNECTED — USE EXTEND'}
                        </Button>
                      </div>

                      <p className="extra-display-note">
                        Requires Miracast support on both the PC and TV. If the TV is not listed,
                        keep using LANCAST Start or connect an HDMI/Miracast adapter.
                      </p>
                    </Modal.Body>
                    <Modal.Footer className="device-modal-footer">
                      <span>Windows may remember this TV for the next connection.</span>
                      <Modal.CloseTrigger className="skeuo-button skeuo-button-md">
                        CLOSE
                      </Modal.CloseTrigger>
                    </Modal.Footer>
                  </Modal.Dialog>
                </Modal.Container>
              </Modal.Backdrop>
            </Modal>

            <div className={`stream-status ${streaming ? 'is-live' : ''}`}>
              <span>{status}</span>
            </div>

            <div>
              <div className="log-console">
                <div className="log-console-header">
                  <span>Signal monitor</span>
                  <button onClick={() => setLog([])} className="log-clear">
                    clear
                  </button>
                </div>
                <div ref={logRef} className="log-readout">
                  {log.length === 0
                    ? <span className="opacity-40">NO SIGNAL EVENTS</span>
                    : log.map((line, i) => (
                        <div key={i} className="log-line whitespace-pre-wrap break-all">
                          {line}
                        </div>
                      ))}
                </div>
              </div>
            </div>
          </div>
        </Panel>
      </main>

      <footer className="app-footer">
        Streaming stays on your LAN · update checks contact GitHub only · no cloud relay or account.
      </footer>
    </div>
  )
}
