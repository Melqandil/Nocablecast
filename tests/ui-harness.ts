const settings = {
  outputMode: 'udp', latencyMode: 'smooth', tvIp: '192.168.1.80', tvPort: '1234', hlsPort: '8090',
  bitrateKbps: '8000', scaleWidth: '1920', fps: '60', ffmpegPath: '', includeAudio: false,
  audioDevice: '', encoderPref: 'auto', captureMethod: 'auto', audioDelayMs: '-112', captureTarget: 'screen',
  monitorLabel: 'All monitors (full virtual desktop)', windowHandle: '', windowTitle: '',
}

const noEvent = () => () => undefined
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
  updateStatus: async () => ({ phase: 'idle', currentVersion: '1.5.0' }),
  installUpdate: async () => ({ ok: true }),
  onLog: noEvent,
  onEnded: noEvent,
  onAudioFallback: noEvent,
  onScanProgress: noEvent,
  onUpdateStatus: noEvent,
}

await import('../src/renderer/src/main.tsx')
