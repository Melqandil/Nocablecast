import { createReadStream, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { resolve } from 'node:path'

export interface HlsServerOptions {
  root: string
  bindAddress: string
  advertisedAddress: string
  port: number
  lowLatency?: boolean
}

export interface HlsServerInfo {
  directUrl: string
  playlistUrl: string
  tvUrl: string
  port: number
}

let current: Server | null = null

function sendText(
  response: import('node:http').ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  })
  response.end(body)
}

function tvReceiverPage(lowLatency = false): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <title>LANCAST TV Receiver</title>
  <style>
    :root { color-scheme: dark; font-family: Arial, Helvetica, sans-serif; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; background: #080b0d; color: #f4f0e7; }
    body { display: flex; align-items: center; justify-content: center; padding: 3vh 3vw; overflow: hidden; }
    .receiver { width: 94vw; max-width: 1500px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 2rem; margin-bottom: 1.5vh; }
    .brand { font-size: 36px; font-size: clamp(24px, 3vw, 52px); font-weight: 900; letter-spacing: .28em; }
    .sub { margin-top: .35rem; color: #9da7a0; font-size: 15px; font-size: clamp(12px, 1.2vw, 20px); letter-spacing: .12em; text-transform: uppercase; }
    .status { display: inline-flex; align-items: center; padding: .7rem 1.1rem; border: 1px solid #3d4641; border-radius: 999px; color: #d3dad5; background: #171c19; font-size: 16px; font-size: clamp(13px, 1.2vw, 20px); font-weight: 700; }
    .status::before { content: ''; width: .8rem; height: .8rem; margin-right: .7rem; border-radius: 50%; background: #d99a32; box-shadow: 0 0 14px rgba(217,154,50,.7); }
    .status.live::before { background: #54ee7c; box-shadow: 0 0 16px rgba(84,238,124,.85); }
    .screen { position: relative; height: 68vh; min-height: 360px; max-height: 844px; overflow: hidden; border: 2px solid #333b37; border-radius: 18px; background: #000; box-shadow: 0 3vh 8vh rgba(0,0,0,.55); }
    video { width: 100%; height: 100%; display: block; background: #000; object-fit: contain; }
    .empty { position: absolute; top: 0; right: 0; bottom: 0; left: 0; display: flex; align-items: center; justify-content: center; padding: 8%; pointer-events: none; text-align: center; }
    .empty strong { display: block; font-size: 36px; font-size: clamp(22px, 3.2vw, 56px); }
    .empty span { display: block; max-width: 45rem; margin-top: 1rem; color: #aeb6b0; font-size: 18px; font-size: clamp(14px, 1.5vw, 24px); line-height: 1.45; }
    .screen.has-picture .empty { display: none; }
    .controls { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; margin-top: 2vh; }
    button { min-width: 11rem; margin: 0 .5rem; padding: .9rem 1.4rem; border: 2px solid #59635d; border-radius: 12px; color: #f7f3e9; background: linear-gradient(#303832, #171c19); font: inherit; font-size: 18px; font-size: clamp(15px, 1.4vw, 23px); font-weight: 800; cursor: pointer; }
    button:focus, button:hover { outline: 4px solid #f0a53b; outline-offset: 4px; background: linear-gradient(#4b554e, #222824); }
    .hint { margin-top: 1.4vh; color: #8d9790; font-size: 13px; font-size: clamp(11px, 1vw, 17px); text-align: center; }
    @media (max-aspect-ratio: 4/3) { body { overflow: auto; } .topbar { align-items: flex-start; } }
  </style>
</head>
<body>
  <main class="receiver">
    <div class="topbar">
      <div><div class="brand">LANCAST</div><div class="sub">Local TV receiver</div></div>
      <div id="status" class="status" role="status">Connecting…</div>
    </div>
    <div id="screen" class="screen">
      <video id="stream" controls autoplay playsinline preload="auto"></video>
      <div class="empty"><div><strong>Ready for your PC</strong><span>Keep LANCAST running, then choose Play stream. The first picture can take a few seconds.</span></div></div>
    </div>
    <div class="controls">
      <button id="play" type="button" autofocus>PLAY STREAM</button>
      <button id="retry" type="button">RETRY</button>
      <button id="fullscreen" type="button">FULLSCREEN</button>
    </div>
    <div class="hint">PC and TV must be on the same local network · ${lowLatency ? 'smooth low-latency mode' : 'compatibility mode'} · no cloud connection</div>
  </main>
  <script>
    (function () {
      var video = document.getElementById('stream');
      var screen = document.getElementById('screen');
      var status = document.getElementById('status');
      var retryTimer = 0;
      var lowLatency = ${lowLatency ? 'true' : 'false'};
      // Stay far enough behind the last complete segment to survive a normal
      // playlist refresh without starving, but recover if the TV drifts back.
      var liveEdgeTarget = 1.1;
      var hardCatchupThreshold = 2.2;

      function moveToLiveEdge(force) {
        if (!lowLatency || video.paused || !video.seekable || !video.seekable.length) return;
        try {
          var range = video.seekable.length - 1;
          var start = video.seekable.start(range);
          var end = video.seekable.end(range);
          var behind = end - video.currentTime;
          if (force || behind > hardCatchupThreshold) {
            video.currentTime = Math.max(start, end - liveEdgeTarget);
          }
        } catch (error) {
          // Some early webOS players briefly expose a changing seekable range.
        }
      }

      function setStatus(message, live) {
        status.textContent = message;
        status.className = live ? 'status live' : 'status';
      }

      function playStream() {
        window.clearTimeout(retryTimer);
        setStatus('Connecting…', false);
        video.src = '/live.m3u8?nocache=' + Date.now();
        video.load();
        var attempt = video.play();
        if (attempt && attempt.catch) {
          attempt.catch(function () { setStatus('Press Play stream', false); });
        }
      }

      document.getElementById('play').addEventListener('click', playStream);
      document.getElementById('retry').addEventListener('click', playStream);
      document.getElementById('fullscreen').addEventListener('click', function () {
        var videoEnter = video.requestFullscreen || video.webkitRequestFullscreen || video.webkitRequestFullScreen;
        var screenEnter = screen.requestFullscreen || screen.webkitRequestFullscreen || screen.webkitRequestFullScreen;
        if (videoEnter) videoEnter.call(video);
        else if (screenEnter) screenEnter.call(screen);
      });

      video.addEventListener('playing', function () {
        screen.className = 'screen has-picture';
        setStatus(lowLatency ? 'Live from PC · low delay' : 'Live from PC', true);
      });
      video.addEventListener('loadedmetadata', function () {
        window.setTimeout(function () { moveToLiveEdge(true); }, 50);
      });
      video.addEventListener('play', function () {
        window.setTimeout(function () { moveToLiveEdge(true); }, 80);
      });
      video.addEventListener('waiting', function () { setStatus('Buffering…', false); });
      video.addEventListener('stalled', function () { setStatus('Waiting for PC…', false); });
      video.addEventListener('pause', function () {
        if (!video.ended && video.currentTime > 0) setStatus('Paused', false);
      });
      video.addEventListener('error', function () {
        screen.className = 'screen';
        setStatus('Stream is starting…', false);
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(playStream, 2500);
      });
      document.addEventListener('keydown', function (event) {
        if (event.keyCode === 415) playStream();
        if (event.keyCode === 19) video.pause();
      });

      window.setTimeout(playStream, 300);
      window.setInterval(function () { moveToLiveEdge(false); }, 1500);
    }());
  </script>
</body>
</html>`
}

/**
 * Serves only the rolling HLS playlist and its generated MPEG-TS segments.
 * Binding to one LAN address prevents the receiver from being exposed on
 * loopback, VPN, or unrelated network adapters.
 */
export async function startHlsServer(options: HlsServerOptions): Promise<HlsServerInfo> {
  await stopHlsServer()

  const root = resolve(options.root)
  let directUrl = ''
  const server = createServer((request, response) => {
    const method = request.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' })
      response.end()
      return
    }

    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    if (pathname === '/' || pathname === '/tv') {
      const body = tvReceiverPage(options.lowLatency)
      if (method === 'HEAD') {
        response.writeHead(200, {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
        })
        response.end()
      } else {
        sendText(response, 200, 'text/html; charset=utf-8', body)
      }
      return
    }

    if (pathname === '/nocablecast.m3u') {
      const body = `#EXTM3U\n#EXTINF:-1,Nocablecast Desktop\n${directUrl}\n`
      if (method === 'HEAD') {
        response.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Content-Type': 'audio/x-mpegurl',
          'Content-Length': Buffer.byteLength(body),
        })
        response.end()
      } else {
        sendText(response, 200, 'audio/x-mpegurl', body)
      }
      return
    }

    const name = pathname.slice(1)
    if (name !== 'live.m3u8' && !/^segment_\d{6}\.ts$/.test(name)) {
      sendText(response, 404, 'text/plain; charset=utf-8', 'Not found.\n')
      return
    }

    const file = resolve(root, name)
    try {
      const stat = statSync(file)
      if (!stat.isFile()) throw new Error('not a file')
      response.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Content-Type': name.endsWith('.m3u8')
          ? 'application/vnd.apple.mpegurl'
          : 'video/mp2t',
        'Content-Length': stat.size,
      })
      if (method === 'HEAD') response.end()
      else createReadStream(file).on('error', () => response.destroy()).pipe(response)
    } catch {
      sendText(response, 404, 'text/plain; charset=utf-8', 'Stream is starting; try again.\n')
    }
  })

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.bindAddress, () => resolveListen())
  })

  current = server
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : options.port
  const base = `http://${options.advertisedAddress}:${port}`
  directUrl = `${base}/live.m3u8`
  return {
    directUrl,
    playlistUrl: `${base}/nocablecast.m3u`,
    tvUrl: `${base}/tv`,
    port,
  }
}

export async function stopHlsServer(): Promise<void> {
  const server = current
  current = null
  if (!server) return

  server.closeAllConnections?.()
  await new Promise<void>((resolveClose) => {
    server.close(() => resolveClose())
  })
}
