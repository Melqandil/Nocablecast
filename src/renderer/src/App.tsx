import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ALL_MONITORS, type Settings, type DisplayInfo, type NetDevice, type FoundDevice } from './api'
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

const OUTPUTS: Option[] = [
  { key: 'udp', label: 'UDP — VLC / Android receiver' },
  { key: 'hls', label: 'HLS — LG / Samsung / IPTV apps' },
]

const PRESETS = [
  { label: '1080p60', width: '1920', fps: '60', bitrate: '8000' },
  { label: '1080p30', width: '1920', fps: '30', bitrate: '6000' },
  { label: '720p60', width: '1280', fps: '60', bitrate: '4000' },
]

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [audioDevices, setAudioDevices] = useState<string[]>([])
  const [audioRaw, setAudioRaw] = useState('')
  const [log, setLog] = useState<string[]>([])
  const [streaming, setStreaming] = useState(false)
  const [status, setStatus] = useState('Idle')
  const [busy, setBusy] = useState<string | null>(null)
  const [found, setFound] = useState<FoundDevice[] | null>(null)
  const [netDevices, setNetDevices] = useState<NetDevice[] | null>(null)
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null)
  const [netFilter, setNetFilter] = useState('')
  const [ffmpegInfo, setFfmpegInfo] = useState<{ ok: boolean; version: string; path: string } | null>(null)
  const [localIp, setLocalIp] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const addLog = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-600), line])
  }, [])

  useEffect(() => {
    api.loadSettings().then(setSettings)
    api.listDisplays().then(setDisplays)
    api.probeFfmpeg().then(setFfmpegInfo)
    const offLog = api.onLog(addLog)
    const offEnd = api.onEnded((code) => {
      setStreaming(false)
      setStatus('Idle')
      addLog(`ffmpeg exited (code ${code}).`)
    })
    const offScan = api.onScanProgress(setScanProgress)
    return () => { offLog(); offEnd(); offScan() }
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
      <div className="grid h-full place-items-center bg-paper">
        <span className="text-[12px] font-black uppercase tracking-[0.2em]">Loading…</span>
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

  const isHls = settings.outputMode === 'hls'
  const hlsBase = localIp ? `http://${localIp}:${settings.hlsPort || '8090'}` : ''
  const playlistUrl = hlsBase ? `${hlsBase}/nocablecast.m3u` : ''
  const directUrl = hlsBase ? `${hlsBase}/live.m3u8` : ''
  const receiverUrl = isHls ? playlistUrl : `udp://@:${settings.tvPort || '1234'}`

  const applyPreset = (p: typeof PRESETS[number]) => {
    set('scaleWidth', p.width); set('fps', p.fps); set('bitrateKbps', p.bitrate)
    addLog(`Preset applied: ${p.width}px wide, ${p.fps}fps, ${p.bitrate}kbps.`)
  }

  const withBusy = async (name: string, fn: () => Promise<void>) => {
    setBusy(name)
    try { await fn() } finally { setBusy(null) }
  }

  const start = async () => {
    const chosen = displays.find((d) => d.label === selectedMonitorKey)
    setStatus('Starting…')
    const res = await api.startStream({
      settings,
      monitor: chosen ? chosen.rect : null,
      monitorIndex: chosen ? chosen.index : 0,
    })
    if (!res.ok) {
      setStatus('Error')
      addLog(res.error ?? 'Could not start.')
      return
    }
    await api.saveSettings(settings)
    setStreaming(true)
    setStatus(`Streaming — ${res.encoder} · ${res.capture} · ${settings.outputMode.toUpperCase()}`)
    if (res.playlistUrl) addLog(`Copy this playlist URL into SS IPTV: ${res.playlistUrl}`)
  }

  const stop = async () => { await api.stopStream(); setStreaming(false); setStatus('Idle') }

  return (
    <div className="flex h-full flex-col bg-paper text-ink">
      {/* Header */}
      <header className="flex items-center justify-between border-b-3 border-ink bg-ink px-4 py-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[22px] font-black uppercase leading-none tracking-[0.22em] text-panel">
            LANCAST
          </h1>
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9c968a]">
            desktop → tv · local network only
          </span>
        </div>
        <div className="flex items-center gap-2">
          {streaming ? <Tag tone="live">● LIVE</Tag> : <Tag>IDLE</Tag>}
          {ffmpegInfo && (
            <Tag tone={ffmpegInfo.ok ? 'good' : 'bad'}>
              {ffmpegInfo.ok ? 'FFMPEG OK' : 'NO FFMPEG'}
            </Tag>
          )}
        </div>
      </header>

      <main className="grid flex-1 gap-3 overflow-auto p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ------------------------------------------------ destination -- */}
        <Panel title="01 · Destination">
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
                setNetDevices(null); setScanProgress({ done: 0, total: 254 })
                addLog('Scanning the local subnet…')
                const devs = await api.scanNetwork()
                setNetDevices(devs); setScanProgress(null)
                addLog(`Scan finished: ${devs.length} device(s) found.`)
              })}>{busy === 'net' ? '…' : 'All devices'}</Button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label={isHls ? 'HTTP port on this PC' : 'UDP port'}>
                <Input value={isHls ? settings.hlsPort : settings.tvPort}
                  onChange={(e) => isHls ? set('hlsPort', e.target.value) : set('tvPort', e.target.value)} />
              </Field>
              <Field label={isHls ? 'SS IPTV external playlist URL' : 'On the TV, open this in VLC'}>
                <div className="flex gap-1">
                  <Input readOnly value={receiverUrl}
                    placeholder={isHls ? 'Enter a valid TV IP first' : undefined}
                    className="bg-[#ddd8c9]" />
                  <Button size="sm" disabled={!receiverUrl}
                    onClick={() => { api.copy(receiverUrl); addLog('Receiver URL copied.') }}>Copy</Button>
                </div>
              </Field>
            </div>

            {isHls && (
              <div className="border-3 border-ink bg-[#fffdf5] p-2 text-[11px] leading-snug">
                <strong>LG / Samsung:</strong> start the stream, then add the playlist URL above as
                an external playlist in SS IPTV. The direct HLS address is{' '}
                <span className="break-all font-bold">{directUrl || 'shown after a valid TV IP is entered'}</span>.
                Allow LANCAST through Windows Firewall on <strong>Private networks</strong> when prompted.
              </div>
            )}

            {found && (
              <div className="border-3 border-ink bg-white">
                <div className="border-b-3 border-ink bg-cobalt px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white">
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
                      className="flex w-full items-center justify-between gap-2 border-b-3 border-ink px-2 py-1 text-left last:border-b-0 hover:bg-blaze hover:text-white">
                      <span className="text-[12px] font-black">{d.ip}</span>
                      <span className="truncate text-[10px] opacity-70">{d.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {scanProgress && (
              <div className="border-3 border-ink bg-white p-2">
                <div className="mb-1 text-[10px] font-black uppercase tracking-[0.14em]">
                  Pinging subnet — {scanProgress.done}/{scanProgress.total}
                </div>
                <div className="h-3 border-3 border-ink bg-paper">
                  <div className="h-full bg-blaze"
                       style={{ width: `${(scanProgress.done / scanProgress.total) * 100}%` }} />
                </div>
              </div>
            )}

            {netDevices && (
              <div className="border-3 border-ink bg-white">
                <div className="flex items-center gap-2 border-b-3 border-ink bg-cobalt px-2 py-1">
                  <span className="text-[10px] font-black uppercase tracking-[0.14em] text-white">
                    Devices — {netDevices.length}
                  </span>
                  <input value={netFilter} onChange={(e) => setNetFilter(e.target.value)}
                    placeholder="filter ip or mac"
                    className="ml-auto w-40 border-2 border-ink bg-white px-1 py-0.5 text-[11px] font-bold" />
                </div>
                <div className="max-h-48 overflow-auto">
                  {netDevices
                    .filter((d) => !netFilter || d.ip.includes(netFilter) || d.mac.includes(netFilter.toLowerCase()))
                    .map((d) => (
                      <button key={d.ip} onClick={() => { set('tvIp', d.ip); setNetDevices(null) }}
                        className="flex w-full items-center justify-between gap-2 border-b-3 border-ink px-2 py-1 text-left last:border-b-0 hover:bg-blaze hover:text-white">
                        <span className="text-[12px] font-black">{d.ip}</span>
                        <span className="text-[10px] opacity-70">{d.mac}</span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        </Panel>

        {/* ----------------------------------------------------- picture -- */}
        <Panel title="02 · Picture">
          <div className="flex flex-col gap-3">
            <Field label="Screen to stream">
              <div className="flex gap-1">
                <BrutalSelect ariaLabel="Screen to stream" options={monitorOptions}
                  value={selectedMonitorKey} onChange={(k) => set('monitorLabel', k)} />
                <Button size="sm" onClick={async () => {
                  const d = await api.listDisplays(); setDisplays(d)
                  addLog(`Detected ${d.length} monitor(s).`)
                }}>Refresh</Button>
              </div>
            </Field>

            <div>
              <span className="text-[10px] font-black uppercase tracking-[0.16em]">Quality preset</span>
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
                <BrutalSelect ariaLabel="Capture method" options={CAPTURES}
                  value={settings.captureMethod} onChange={(k) => set('captureMethod', k)} />
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
                  why it gets worse when your PC is also servicing a live audio device.
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
              <details className="border-3 border-ink bg-white p-2">
                <summary className="cursor-pointer text-[11px] font-black uppercase tracking-[0.12em]">
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
            </div>

            <div className={`border-3 border-ink px-3 py-2 ${streaming ? 'stripes' : 'bg-panel'}`}>
              <span className="inline-block bg-panel px-2 py-0.5 text-[11px] font-black uppercase tracking-[0.14em]">
                {status}
              </span>
            </div>

            <div>
              <div className="flex items-center justify-between border-3 border-b-0 border-ink bg-ink px-2 py-1">
                <span className="text-[10px] font-black uppercase tracking-[0.14em] text-panel">Log</span>
                <button onClick={() => setLog([])}
                  className="text-[10px] font-black uppercase tracking-[0.14em] text-[#9c968a] hover:text-blaze">
                  clear
                </button>
              </div>
              <div ref={logRef}
                className="h-56 overflow-auto border-3 border-ink bg-white p-2 text-[11px] leading-snug">
                {log.length === 0
                  ? <span className="opacity-40">Nothing yet.</span>
                  : log.map((line, i) => (
                      <div key={i} className="whitespace-pre-wrap break-all border-b border-dashed border-[#ddd8c9] py-0.5">
                        {line}
                      </div>
                    ))}
              </div>
            </div>
          </div>
        </Panel>
      </main>

      <footer className="border-t-3 border-ink bg-ink px-4 py-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9c968a]">
          Traffic is bound to your LAN adapter — never touches the internet, works with it unplugged.
        </span>
      </footer>
    </div>
  )
}
