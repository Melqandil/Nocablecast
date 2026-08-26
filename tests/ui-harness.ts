const qr = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="white"/><path d="M8 8h28v28H8zm56 0h28v28H64zM8 64h28v28H8zm42-14h12v12H50zm18 18h24v24H68zM42 74h14v18H42z" fill="#18201a"/></svg>')}`

const settings = {
  outputMode: 'udp', latencyMode: 'smooth', tvIp: '192.168.1.80', tvPort: '1234', hlsPort: '8090',
  bitrateKbps: '8000', scaleWidth: '1920', fps: '60', ffmpegPath: '', includeAudio: false,
  audioDevice: '', encoderPref: 'auto', captureMethod: 'auto', audioDelayMs: '-112', captureTarget: 'screen',
  monitorLabel: 'All monitors (full virtual desktop)', windowHandle: '', windowTitle: '',
}

const noEvent = () => () => undefined
const fallbackPreview = (callback: (frame: Uint8Array) => void) => {
  let cancelled = false
  const sendFrame = async () => {
    const image = await fetch('/docs/screenshot.png')
    if (!cancelled) callback(new Uint8Array(await image.arrayBuffer()))
  }
  const timer = window.setInterval(() => { void sendFrame() }, 800)
  return () => { cancelled = true; window.clearInterval(timer) }
}
window.lancast = {
  loadSettings: async () => settings,
  saveSettings: async () => true,
  getDefaults: async () => settings,
  copy: async () => true,
  openExternal: async () => undefined,
  openWirelessDisplayPicker: async () => ({ ok: true }),
  useExtendMode: async () => ({ ok: true }),
  probeFfmpeg: async () => ({ ok: true, version: 'ffmpeg test', path: 'ffmpeg.exe' }),
  listDisplays: async () => [{ index: 0, label: 'Display 1 · 1920×1080', rect: { left: 0, top: 0, width: 1920, height: 1080 }, primary: true, scaleFactor: 1 }],
  listWindows: async () => [],
  listAudioDevices: async () => ({ devices: [], raw: '' }),
  detectEncoder: async () => 'h264_nvenc',
  discover: async () => [],
  scanNetwork: async () => [],
  getLocalIp: async () => '192.168.1.20',
  startStream: async () => ({ ok: true }),
  stopStream: async () => true,
  streamStatus: async () => false,
  startPhoneCamera: async () => ({ ok: true, info: {
    localIp: '192.168.1.20', hostname: 'lancast-test.local', setupUrl: 'http://192.168.1.20:8091',
    phoneUrl: 'https://192.168.1.20:8443/phone?token=test', setupQr: qr, phoneQr: qr,
    certificateName: 'LANCAST Local Camera TEST', framePath: 'C:\\ProgramData\\LANCAST\\phone-camera.jpg',
  } }),
  stopPhoneCamera: async () => true,
  phoneCameraStatus: async () => ({ state: 'stopped', info: null, virtualCamera: {
    supported: true, installed: false, running: false, bundleAvailable: true,
    message: 'Install the LANCAST camera component once, then it will appear in camera apps.',
  } }),
  sendPhoneCameraSignal: () => undefined,
  sendPhoneCameraFrame: () => undefined,
  installVirtualCamera: async () => ({ ok: true, virtualCamera: { supported: true, installed: true, running: false, bundleAvailable: true, message: 'Installed.' } }),
  startVirtualCamera: async () => ({ ok: true, virtualCamera: { supported: true, installed: true, running: true, bundleAvailable: true, message: 'Running.' } }),
  stopVirtualCamera: async () => ({ supported: true, installed: true, running: false, bundleAvailable: true, message: 'Stopped.' }),
  updateStatus: async () => ({ phase: 'idle', currentVersion: '1.5.0' }),
  installUpdate: async () => ({ ok: true }),
  onLog: noEvent,
  onEnded: noEvent,
  onScanProgress: noEvent,
  onUpdateStatus: noEvent,
  onPhoneCameraSignal: noEvent,
  onPhoneCameraFrame: fallbackPreview,
  onPhoneCameraState: noEvent,
}

await import('../src/renderer/src/main.tsx')
