import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'

import forge from 'node-forge'
import QRCode from 'qrcode'
import { WebSocket, WebSocketServer } from 'ws'

export interface PhoneCameraInfo {
  localIp: string
  hostname: string
  setupUrl: string
  phoneUrl: string
  setupQr: string
  phoneQr: string
  certificateName: string
  framePath: string
}

export type PhoneCameraState = 'stopped' | 'ready' | 'connected' | 'streaming'

export interface PhoneCameraServerOptions {
  root: string
  framePath: string
  localIp?: string
  setupPort?: number
  httpsPort?: number
  protectSecret(value: string): string
  unprotectSecret(value: string): string
  onSignal(message: unknown): void
  onFrame(frame: Uint8Array): void
  onState(state: PhoneCameraState, message: string): void
}

interface StoredIdentity {
  hostname: string
  ip: string
  certificateName: string
  caCertificatePem: string
  caPrivateKey: string
  serverCertificatePem: string
  serverPrivateKey: string
  createdAt: string
}

let httpServer: HttpServer | null = null
let httpsServer: HttpsServer | null = null
let socketServer: WebSocketServer | null = null
let senderSocket: WebSocket | null = null
let activeInfo: PhoneCameraInfo | null = null

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 169 && parts[1] === 254)
}

export function findPhoneCameraIp(): string | null {
  const candidates: Array<{ ip: string; score: number }> = []
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    const lower = name.toLowerCase()
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal || !isPrivateIpv4(address.address)) continue
      let score = 0
      if (/wi-?fi|wireless|wlan|ethernet|lan/.test(lower)) score += 20
      if (/vethernet|virtual|vpn|tailscale|zerotier|hamachi|loopback/.test(lower)) score -= 30
      if (address.address.startsWith('192.168.')) score += 5
      candidates.push({ ip: address.address, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]?.ip ?? null
}

function serialNumber(): string {
  return `0${randomBytes(15).toString('hex')}`
}

function certificateAttrs(commonName: string): forge.pki.CertificateField[] {
  return [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'LANCAST' },
    { name: 'organizationalUnitName', value: 'Local Phone Camera' },
  ]
}

function makeLeaf(
  caCertificate: forge.pki.Certificate,
  caPrivateKey: forge.pki.rsa.PrivateKey,
  hostname: string,
  ip: string,
): { certificatePem: string; privateKeyPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const certificate = forge.pki.createCertificate()
  certificate.publicKey = keys.publicKey
  certificate.serialNumber = serialNumber()
  certificate.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000)
  certificate.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  certificate.setSubject(certificateAttrs(hostname))
  certificate.setIssuer(caCertificate.subject.attributes)
  certificate.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectKeyIdentifier' },
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: hostname },
        { type: 7, ip },
      ],
    },
  ])
  certificate.sign(caPrivateKey, forge.md.sha256.create())
  return {
    certificatePem: forge.pki.certificateToPem(certificate),
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
  }
}

function identityPath(root: string): string {
  return join(root, 'phone-camera-identity.json')
}

function createIdentity(ip: string, protectSecret: (value: string) => string): StoredIdentity {
  const caKeys = forge.pki.rsa.generateKeyPair(2048)
  const caCertificate = forge.pki.createCertificate()
  const id = randomBytes(4).toString('hex')
  const hostname = `lancast-${id}.local`
  const certificateName = `LANCAST Local Camera ${id.toUpperCase()}`
  caCertificate.publicKey = caKeys.publicKey
  caCertificate.serialNumber = serialNumber()
  caCertificate.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000)
  caCertificate.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000)
  caCertificate.setSubject(certificateAttrs(certificateName))
  caCertificate.setIssuer(caCertificate.subject.attributes)
  caCertificate.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true },
    { name: 'subjectKeyIdentifier' },
  ])
  caCertificate.sign(caKeys.privateKey, forge.md.sha256.create())

  const leaf = makeLeaf(caCertificate, caKeys.privateKey, hostname, ip)
  return {
    hostname,
    ip,
    certificateName,
    caCertificatePem: forge.pki.certificateToPem(caCertificate),
    caPrivateKey: protectSecret(forge.pki.privateKeyToPem(caKeys.privateKey)),
    serverCertificatePem: leaf.certificatePem,
    serverPrivateKey: protectSecret(leaf.privateKeyPem),
    createdAt: new Date().toISOString(),
  }
}

function loadIdentity(
  root: string,
  ip: string,
  protectSecret: (value: string) => string,
  unprotectSecret: (value: string) => string,
): StoredIdentity {
  const path = identityPath(root)
  try {
    const stored = JSON.parse(readFileSync(path, 'utf8')) as StoredIdentity
    const caCertificate = forge.pki.certificateFromPem(stored.caCertificatePem)
    const caPrivateKey = forge.pki.privateKeyFromPem(unprotectSecret(stored.caPrivateKey))
    if (stored.ip !== ip) {
      const leaf = makeLeaf(caCertificate, caPrivateKey, stored.hostname, ip)
      stored.ip = ip
      stored.serverCertificatePem = leaf.certificatePem
      stored.serverPrivateKey = protectSecret(leaf.privateKeyPem)
      stored.createdAt = new Date().toISOString()
      writeFileSync(path, JSON.stringify(stored, null, 2), { mode: 0o600 })
    }
    return stored
  } catch {
    const identity = createIdentity(ip, protectSecret)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(identity, null, 2), { mode: 0o600 })
    return identity
  }
}

function xml(value: string): string {
  return value.replace(/[<>&'\"]/g, (character) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  })[character] ?? character)
}

function mobileConfig(identity: StoredIdentity): string {
  const certificate = forge.pki.certificateFromPem(identity.caCertificatePem)
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes()
  const payload = forge.util.encode64(der, 64)
  const profileId = randomUUID().toUpperCase()
  const certificateId = randomUUID().toUpperCase()
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadContent</key><array><dict>
<key>PayloadCertificateFileName</key><string>${xml(identity.certificateName)}.cer</string>
<key>PayloadContent</key><data>${payload}</data>
<key>PayloadDescription</key><string>Trust this PC for the LANCAST local phone-camera page.</string>
<key>PayloadDisplayName</key><string>${xml(identity.certificateName)}</string>
<key>PayloadIdentifier</key><string>com.lancast.local-camera.certificate.${certificateId}</string>
<key>PayloadType</key><string>com.apple.security.root</string>
<key>PayloadUUID</key><string>${certificateId}</string>
<key>PayloadVersion</key><integer>1</integer>
</dict></array>
<key>PayloadDescription</key><string>Enables private HTTPS between this phone and your LANCAST PC. No cloud or account.</string>
<key>PayloadDisplayName</key><string>${xml(identity.certificateName)}</string>
<key>PayloadIdentifier</key><string>com.lancast.local-camera.profile.${profileId}</string>
<key>PayloadOrganization</key><string>LANCAST</string>
<key>PayloadRemovalDisallowed</key><false/>
<key>PayloadType</key><string>Configuration</string>
<key>PayloadUUID</key><string>${profileId}</string>
<key>PayloadVersion</key><integer>1</integer>
</dict></plist>`
}

function setupPage(info: Pick<PhoneCameraInfo, 'phoneUrl' | 'certificateName'>): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<meta charset="utf-8"><title>Set up LANCAST Phone Camera</title><style>${phoneCss()}</style></head>
<body><main class="card setup"><div class="brand">LANCAST</div><h1>One-time secure setup</h1>
<p>This certificate lets your phone trust only the private camera page hosted by this LANCAST PC.</p>
<ol><li>Open this setup page in <b>Safari</b>. Chrome may save the profile as an ordinary file.</li>
<li><a class="button" href="/lancast-camera.mobileconfig">2 · Download certificate</a></li>
<li>Within eight minutes, open the main <b>Settings</b> screen, tap <b>Profile Downloaded</b>, then install <b>${xml(info.certificateName)}</b>.</li>
<li>Open <b>Settings → General → About → Certificate Trust Settings</b> and enable full trust for it.</li>
<li><a class="button secondary" href="${xml(info.phoneUrl)}">5 · Open secure camera</a></li></ol>
<p class="small">No internet, cloud service, or account is used. Remove the profile later from VPN &amp; Device Management if you no longer use this PC.</p>
</main></body></html>`
}

function phoneCss(): string {
  return `:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at top,#263b35,#080b0a 60%);color:#f5f0e5;display:grid;place-items:center;padding:20px}.card{width:min(94vw,680px);padding:26px;border:1px solid #52655d;border-radius:22px;background:rgba(15,21,18,.94);box-shadow:0 24px 70px #000}.brand{color:#76f39b;font-weight:900;letter-spacing:.28em}.setup h1{font-size:clamp(25px,7vw,42px)}ol{padding-left:1.3rem}li{margin:18px 0;line-height:1.45}.button,button{display:block;width:100%;padding:15px;border:0;border-radius:13px;background:#41b976;color:#07130c;text-align:center;text-decoration:none;font-size:17px;font-weight:850}.secondary{background:#d69f4b;color:#170f05}.small,.hint{color:#9eb0a7;font-size:13px;line-height:1.5}.camera{width:min(96vw,900px)}video{width:100%;max-height:62vh;border-radius:16px;background:#000;object-fit:contain}.row{display:flex;gap:10px;margin-top:12px}.row button{flex:1}.status{margin:12px 0;color:#aebbb4}.status.live{color:#72ee97}`
}

function phonePage(token: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta charset="utf-8"><title>LANCAST Phone Camera</title><style>${phoneCss()}</style></head>
<body><main class="card camera"><div class="brand">LANCAST</div><h1>Phone Camera</h1>
<div id="status" class="status">Ready to connect</div><video id="preview" autoplay muted playsinline></video>
<canvas id="transport" hidden></canvas>
<div class="row"><button id="start">START CAMERA</button><button id="flip" class="secondary">FLIP</button></div>
<p class="hint">Keep this page open and the phone unlocked. LANCAST tries WebRTC first and automatically uses the same encrypted local connection if UDP is blocked.</p></main>
<script>(function(){
var preview=document.getElementById('preview');var transport=document.getElementById('transport');var status=document.getElementById('status');var socket=null;var peer=null;var stream=null;var facing='environment';var pendingCandidates=[];var fallbackTimer=null;var fallbackRun=0;
function setStatus(text,live){status.textContent=text;status.className=live?'status live':'status';}
function send(message){if(socket&&socket.readyState===1)socket.send(JSON.stringify(message));}
function stopFallback(){fallbackRun++;if(fallbackTimer){clearTimeout(fallbackTimer);fallbackTimer=null;}}
function startFallback(){stopFallback();var run=fallbackRun;setStatus('LIVE TO PC · SECURE FALLBACK',true);send({type:'fallback-started'});var context=transport.getContext('2d',{alpha:false});function next(delay){if(run===fallbackRun)fallbackTimer=setTimeout(pump,delay);}function pump(){if(run!==fallbackRun)return;if(peer&&peer.connectionState==='connected'){stopFallback();return;}if(!context||!socket||socket.readyState!==1||!stream||preview.readyState<2||socket.bufferedAmount>700000){next(70);return;}var width=960;var height=540;transport.width=width;transport.height=height;var sw=preview.videoWidth||width;var sh=preview.videoHeight||height;var scale=Math.min(width/sw,height/sh);var dw=Math.round(sw*scale);var dh=Math.round(sh*scale);context.fillStyle='#000';context.fillRect(0,0,width,height);context.drawImage(preview,(width-dw)/2,(height-dh)/2,dw,dh);transport.toBlob(function(blob){if(!blob){next(70);return;}blob.arrayBuffer().then(function(buffer){if(run===fallbackRun&&socket&&socket.readyState===1&&socket.bufferedAmount<700000)socket.send(buffer);}).finally(function(){next(55);});},'image/jpeg',0.76);}pump();}
function disconnect(){stopFallback();pendingCandidates=[];if(peer){peer.close();peer=null;}if(socket){socket.onclose=null;socket.close();socket=null;}if(stream){stream.getTracks().forEach(function(track){track.stop();});stream=null;}}
function connectSocket(){return new Promise(function(resolve,reject){socket=new WebSocket('wss://'+location.host+'/camera?token=${token}');socket.onopen=resolve;socket.onerror=reject;socket.onmessage=async function(event){var message=JSON.parse(event.data);if(!peer)return;if(message.type==='answer'){await peer.setRemoteDescription(message.description);for(var i=0;i<pendingCandidates.length;i++)await peer.addIceCandidate(pendingCandidates[i]).catch(function(){});pendingCandidates=[];}if(message.type==='candidate'&&message.candidate){if(peer.remoteDescription)peer.addIceCandidate(message.candidate).catch(function(){});else pendingCandidates.push(message.candidate);}};socket.onclose=function(){setStatus('Disconnected — press Start to reconnect',false);};});}
async function start(){try{disconnect();setStatus('Requesting camera permission…',false);stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}},audio:false});preview.srcObject=stream;await preview.play();await connectSocket();peer=new RTCPeerConnection({iceServers:[]});stream.getVideoTracks().forEach(function(track){peer.addTrack(track,stream);});peer.onicecandidate=function(event){if(event.candidate)send({type:'candidate',candidate:event.candidate});};peer.onconnectionstatechange=function(){var state=peer.connectionState;if(state==='connected'){stopFallback();send({type:'media-connected'});setStatus('LIVE TO PC',true);}else if(state==='failed'||state==='disconnected'){startFallback();}};var offer=await peer.createOffer();await peer.setLocalDescription(offer);send({type:'offer',description:peer.localDescription});setStatus('Connecting to LANCAST…',false);fallbackTimer=setTimeout(startFallback,2500);}catch(error){setStatus(error&&error.message?error.message:'Camera could not start',false);}}
document.getElementById('start').onclick=start;document.getElementById('flip').onclick=function(){facing=facing==='environment'?'user':'environment';start();};
window.addEventListener('pagehide',disconnect);
}());</script></body></html>`
}

function listen(server: HttpServer | HttpsServer, port: number, ip: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, ip, () => resolve())
  })
}

export async function startPhoneCameraServer(options: PhoneCameraServerOptions): Promise<PhoneCameraInfo> {
  await stopPhoneCameraServer()
  const ip = options.localIp ?? findPhoneCameraIp()
  if (!ip) throw new Error('No private Wi-Fi or Ethernet address was found on this PC.')

  const setupPort = options.setupPort ?? 8091
  const securePort = options.httpsPort ?? 8443
  const identity = loadIdentity(options.root, ip, options.protectSecret, options.unprotectSecret)
  const token = randomBytes(18).toString('base64url')
  const setupUrl = `http://${ip}:${setupPort}`
  const phoneUrl = `https://${ip}:${securePort}/phone?token=${token}`
  const infoBase = {
    localIp: ip,
    hostname: identity.hostname,
    setupUrl,
    phoneUrl,
    certificateName: identity.certificateName,
    framePath: options.framePath,
  }

  httpServer = createHttpServer((request, response) => {
    const path = new URL(request.url ?? '/', setupUrl).pathname
    if (path === '/lancast-camera.mobileconfig') {
      const body = mobileConfig(identity)
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/x-apple-aspen-config',
        'Content-Disposition': 'attachment; filename="LANCAST-Local-Camera.mobileconfig"',
        'Content-Length': Buffer.byteLength(body),
      })
      response.end(body)
      return
    }
    const body = setupPage(infoBase)
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    })
    response.end(body)
  })

  httpsServer = createHttpsServer({
    cert: identity.serverCertificatePem,
    key: options.unprotectSecret(identity.serverPrivateKey),
  }, (request, response) => {
    const url = new URL(request.url ?? '/', phoneUrl)
    if (url.pathname === '/health') {
      const body = JSON.stringify({ ok: true, connected: senderSocket?.readyState === WebSocket.OPEN })
      response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
      response.end(body)
      return
    }
    if (url.pathname !== '/' && url.pathname !== '/phone') {
      response.writeHead(404, { 'Content-Type': 'text/plain' })
      response.end('Not found.')
      return
    }
    if (url.searchParams.get('token') !== token) {
      response.writeHead(403, { 'Content-Type': 'text/plain' })
      response.end('Open the current QR code from LANCAST.')
      return
    }
    const body = phonePage(token)
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' wss:; media-src 'self' blob:",
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    })
    response.end(body)
  })

  socketServer = new WebSocketServer({ noServer: true })
  httpsServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', phoneUrl)
    if (url.pathname !== '/camera' || url.searchParams.get('token') !== token) {
      socket.destroy()
      return
    }
    socketServer?.handleUpgrade(request, socket, head, (webSocket) => socketServer?.emit('connection', webSocket, request))
  })

  socketServer.on('connection', (webSocket) => {
    senderSocket?.close(1000, 'Another phone connected.')
    senderSocket = webSocket
    options.onState('connected', 'Phone connected. Waiting for its camera…')
    webSocket.on('message', (data, binary) => {
      if (binary) {
        const frame = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.from(data as ArrayBuffer)
        if (frame.length >= 32 && frame.length <= 2_500_000
          && frame[0] === 0xff && frame[1] === 0xd8 && frame[2] === 0xff) {
          options.onFrame(frame)
          options.onState('streaming', 'Phone camera is live over the secure local fallback.')
        }
        return
      }
      try {
        const message = JSON.parse(data.toString())
        if (message?.type === 'offer') options.onState('connected', 'Phone connected. Negotiating the fastest media path…')
        if (message?.type === 'media-connected') options.onState('streaming', 'Phone camera is live over WebRTC.')
        if (message?.type === 'fallback-started') options.onState('connected', 'WebRTC was blocked. Starting the secure local fallback…')
        options.onSignal(message)
      } catch {
        // Ignore malformed signaling data from the local page.
      }
    })
    webSocket.on('close', () => {
      if (senderSocket === webSocket) senderSocket = null
      options.onState('ready', 'Ready — scan the camera QR code.')
    })
  })

  try {
    await listen(httpServer, setupPort, ip)
    await listen(httpsServer, securePort, ip)
  } catch (error) {
    await stopPhoneCameraServer()
    throw error
  }

  const [setupQr, phoneQr] = await Promise.all([
    QRCode.toDataURL(setupUrl, { width: 420, margin: 1, errorCorrectionLevel: 'M' }),
    QRCode.toDataURL(phoneUrl, { width: 420, margin: 1, errorCorrectionLevel: 'M' }),
  ])
  activeInfo = { ...infoBase, setupQr, phoneQr }
  options.onState('ready', 'Ready — scan the camera QR code.')
  return activeInfo
}

export function sendPhoneCameraSignal(message: unknown): boolean {
  if (!senderSocket || senderSocket.readyState !== WebSocket.OPEN) return false
  senderSocket.send(JSON.stringify(message))
  return true
}

export function getPhoneCameraInfo(): PhoneCameraInfo | null {
  return activeInfo
}

export async function stopPhoneCameraServer(): Promise<void> {
  const sender = senderSocket
  senderSocket = null
  sender?.close(1001, 'LANCAST phone camera stopped.')
  socketServer?.close()
  socketServer = null
  activeInfo = null
  const servers = [httpServer, httpsServer].filter(Boolean) as Array<HttpServer | HttpsServer>
  httpServer = null
  httpsServer = null
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections?.()
    server.close(() => resolve())
  })))
}
