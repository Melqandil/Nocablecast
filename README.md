# LANCAST

Stream your Windows desktop to a TV over your own network. No internet, no cloud, no account, no subscription. The picture goes straight from your PC to your TV across the router, and works with the internet unplugged.

![LANCAST](docs/screenshot.png)

---

## What it does

Your PC captures the screen, encodes it on the GPU, and pushes it to VLC on your TV as a plain video stream. Anything that runs VLC works as a receiver — most smart TVs, Android TV boxes, Fire sticks, an old laptop plugged into a monitor.

- **1080p60 with sound**, on hardware that can manage it
- **Local network only** — the stream is bound to your LAN adapter, so it cannot use your internet connection even by accident
- **Nothing to install on the TV** except VLC, which is free
- **ffmpeg comes bundled** — no PATH setup, no separate download

## Install

1. Download `LANCAST-Setup-x.y.z.exe` from [Releases](../../releases/latest).
2. Run it.

Windows will likely warn you that the publisher is unrecognised — that happens with any installer that hasn't been signed with a paid certificate, which this isn't. Click **More info → Run anyway** if you're comfortable with that; the source is all here if you'd rather read it or build it yourself.

## Use it

**On the TV**, install VLC, open **Network Stream**, and enter the address LANCAST shows you (it looks like `udp://@:1234`).

**On the PC**, open LANCAST:

1. Put in your TV's IP address. **Find TV** searches for it; **All devices** lists everything on your network if that doesn't turn it up. Your TV also shows it under network settings.
2. Pick a quality preset — **1080p60** to start.
3. Press **Start**.

The picture should appear on the TV within a few seconds.

## Sound

Windows has no single "system audio" input, so sound needs one free extra piece: [VB-Audio Virtual Cable](https://vb-audio.com/Cable/). Install it, then:

**To send everything you hear:** set `CABLE Input` as your Windows output device (Settings → Sound → Output), and turn on *Listen to this device* on it in the Recording tab so you still hear things yourself. In LANCAST, tick **Include audio** and choose `CABLE Output`.

**To send just one app:** leave your speakers as the default output. In Settings → System → Sound → Volume mixer, change only that app's output to `CABLE Input`. Everything else keeps playing through your speakers. Choose `CABLE Output` in LANCAST as before.

### If sound and picture are out of step

Use the **Sync (ms)** box. Work out which one is late first, because the sign depends on it:

- Sound arrives **after** the picture → **negative** number (e.g. `-200`), which pulls audio earlier
- Sound arrives **before** the picture → **positive** number (e.g. `200`), which holds audio back

Adjust by 100 until the gap closes, then by 25. If a change makes it clearly worse, the sign is backwards.

The default is `-112`, measured on one real TV. It is not a universal figure — it depends on how long your particular TV buffers video before displaying it — so expect to retune it. It's saved once you find it.

## If something's wrong

**The picture is cropped or zoomed in.** This should not happen any more, but if it does, press **Refresh** next to the screen picker — the sizes listed should match your monitors' real resolutions. Windows reports scaled-down sizes to apps that haven't opted out of display scaling, and ffmpeg captures in real pixels, so a mismatch makes it grab only a corner of the screen.

**The frame rate is poor.** Check the status line while streaming — it names the capture method. **GDI** copies every frame through your CPU (about 8 MB per frame at 1080p, roughly half a gigabyte per second at 60fps) and often cannot hold 60fps. **Desktop Duplication** takes the finished frame from the GPU instead and is dramatically faster. LANCAST tries Desktop Duplication first and falls back to GDI, saying why in the log. If you're stuck on GDI, drop to 1080p30.

**The picture freezes for a moment now and then.** The stream is plain UDP with no retransmission, which is what keeps it fast. A dropped packet — normal on Wi-Fi — costs up to half a second before the next keyframe restores the picture. Lower the bitrate, or put the TV on Ethernet.

**Nothing arrives at the TV.** Check the port matches on both sides, and allow LANCAST through Windows Firewall on **Private** networks when prompted. Some routers block client-to-client traffic ("AP isolation" or "client isolation") — that has to be turned off in the router.

## Build it yourself

```bash
npm install
npm run fetch:ffmpeg    # downloads the ffmpeg binary to bundle
npm run dev             # run in development
npm run dist            # produce a Windows installer in release/
```

Pushing a tag (`v1.0.1`) builds the installer on a Windows runner and attaches it to a GitHub release. `npm test` runs the suite.

## How it works

```
Screen ──▶ Desktop Duplication (GPU) ──▶ NVENC ──┐
                                                  ├──▶ MPEG-TS ──▶ UDP ──▶ VLC on the TV
Audio ──▶ DirectShow (50ms chunks) ──▶ AAC ───────┘
```

Two decisions carry most of the quality, and both were learned the hard way:

**The video half of the ffmpeg command is identical whether or not audio is enabled.** Combining a screen and a sound source tempts you into ffmpeg's global timestamp and frame-pacing options (`-use_wallclock_as_timestamps`, `-max_interleave_delta`, `-fps_mode`, `-async`). Those act on the *video* stream too, and throttled it to roughly one frame per second the moment audio was switched on. Audio drift is corrected only on the audio side, where it cannot slow video down. There is a test that fails if this ever regresses.

**Audio latency is set at capture, not compensated afterwards.** DirectShow hands audio over in chunks and nothing can be sent until a chunk fills, so chunk size is a hard latency floor. The device default is commonly 500ms — enough on its own to put sound clearly behind the picture. LANCAST asks for 50ms.

`legacy/` holds the original Python version this grew out of. It still works, and the test suite pins the new implementation's ffmpeg output to it exactly, across 72 configurations — it is the reference for every tuned value here.

## Licence

GPL-3.0. LANCAST bundles [ffmpeg](https://ffmpeg.org/), which is licensed under the GPL/LGPL; the bundled build is fetched from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) at build time and is not redistributed in this repository.
