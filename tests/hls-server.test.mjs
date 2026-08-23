import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startHlsServer, stopHlsServer } from '../out-test/hls-server.js'

test('HLS server exposes the TV receiver, IPTV playlist, and generated stream files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nocablecast-hls-'))
  try {
    await writeFile(join(root, 'live.m3u8'), '#EXTM3U\n#EXT-X-TARGETDURATION:1\n')
    await writeFile(join(root, 'segment_000001.ts'), Buffer.from([0x47, 0x40, 0x00]))

    const info = await startHlsServer({
      root,
      bindAddress: '127.0.0.1',
      advertisedAddress: '127.0.0.1',
      port: 0,
      lowLatency: true,
    })

    const receiver = await fetch(info.tvUrl)
    assert.equal(receiver.status, 200)
    assert.match(receiver.headers.get('content-type'), /text\/html/)
    const receiverHtml = await receiver.text()
    assert.match(receiverHtml, /LANCAST TV Receiver/)
    assert.match(receiverHtml, /id="stream"/)
    assert.match(receiverHtml, /\/live\.m3u8/)
    assert.match(receiverHtml, /id="play"[^>]*>PLAY STREAM</)
    assert.match(receiverHtml, /id="fullscreen"[^>]*>FULLSCREEN</)
    assert.match(receiverHtml, /smooth low-latency mode/)
    assert.match(receiverHtml, /var lowLatency = true/)
    assert.match(receiverHtml, /liveEdgeTarget = 3\.2/)
    assert.match(receiverHtml, /hardCatchupThreshold = 5\.0/)
    assert.match(receiverHtml, /video\.readyState < 3/)
    assert.match(receiverHtml, /moveToLiveEdge\(false\)/)
    assert.doesNotMatch(receiverHtml, /https?:\/\//)

    const receiverHome = await fetch(info.tvUrl.replace('/tv', '/'))
    assert.equal(receiverHome.status, 200)
    assert.match(await receiverHome.text(), /LANCAST TV Receiver/)

    const receiverHead = await fetch(info.tvUrl, { method: 'HEAD' })
    assert.equal(receiverHead.status, 200)
    assert.match(receiverHead.headers.get('content-type'), /text\/html/)
    assert.equal(await receiverHead.text(), '')

    const external = await fetch(info.playlistUrl)
    assert.equal(external.status, 200)
    assert.match(external.headers.get('content-type'), /mpegurl/)
    assert.equal(
      await external.text(),
      `#EXTM3U\n#EXTINF:-1,Nocablecast Desktop\n${info.directUrl}\n`,
    )

    const live = await fetch(info.directUrl)
    assert.equal(live.status, 200)
    assert.match(live.headers.get('content-type'), /mpegurl/)
    assert.match(await live.text(), /EXT-X-TARGETDURATION/)

    const segment = await fetch(info.directUrl.replace('live.m3u8', 'segment_000001.ts'))
    assert.equal(segment.status, 200)
    assert.equal(segment.headers.get('content-type'), 'video/mp2t')
    assert.deepEqual(new Uint8Array(await segment.arrayBuffer()), new Uint8Array([0x47, 0x40, 0x00]))

    const hidden = await fetch(info.directUrl.replace('live.m3u8', 'settings.json'))
    assert.equal(hidden.status, 404)
  } finally {
    await stopHlsServer()
    await rm(root, { recursive: true, force: true })
  }
})
