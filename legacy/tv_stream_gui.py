#!/usr/bin/env python3
"""
tv_stream_gui.py
----------------
A simple desktop app (no extra installs beyond ffmpeg -- this uses only
Python's standard library, including tkinter, which ships with the normal
Windows installer from python.org) that streams your screen to VLC running
on your TV over your local network.

Same idea as tv_stream_vlc.py, just with fields and buttons instead of
editing constants and running from a terminal.

REQUIREMENTS
  - ffmpeg installed and on PATH (or point "ffmpeg path" at ffmpeg.exe).
    Get it from https://www.gyan.dev/ffmpeg/builds/ (the "essentials" build)
    if you don't have it.
  - VLC on your TV (you already have this) with a Network Stream opened at
    udp://@:<port> (matching the port shown in this app) -- this app shows
    you that exact string with a Copy button.

USE
  python tv_stream_gui.py

  1. Fill in your TV's IP address (Settings/About on the TV shows it).
  2. Click "Detect encoder" (optional -- Start does this automatically too)
     to see whether your PC has a hardware encoder available.
  3. On the TV, open VLC's Network Stream and paste in the udp://@:PORT
     string shown in this app.
  4. Click "Start Streaming".
  5. Click "Stop" (or just close the window) to end the stream.

  Your settings are remembered in tv_stream_gui_config.json next to this
  script, so you only need to type the TV's IP once.

OPTIONAL: CHOOSING A SCREEN
  If you have more than one monitor, use the "Screen to stream" dropdown
  (click "Detect monitors" to refresh it) to capture just one of them
  instead of your whole virtual desktop.

OPTIONAL: CHOOSING THE ENCODER (GPU vs CPU)
  "Auto (recommended)" already prefers your GPU: it tries NVIDIA (NVENC),
  then Intel (Quick Sync), then AMD (AMF), and only falls back to slower
  CPU (software) encoding if none of those actually work on this PC. If
  your PC has more than one GPU (e.g. a laptop with both an Intel
  integrated GPU and an NVIDIA/AMD discrete one) and Auto isn't picking
  the one you want, use the Encoder dropdown to force a specific one. The
  active encoder is always shown in the status line above the log (e.g.
  "Streaming (encoder: h264_nvenc)"), so you can confirm the GPU is
  actually being used.

OPTIONAL: DESKTOP AUDIO
  Check "Include" next to Desktop audio, then click "List audio devices"
  and pick one. Windows has no single built-in "system audio" source, so
  this only works if a loopback-capable device shows up in that list --
  usually "Stereo Mix" (enable it in Windows Sound settings > Recording
  tab > right-click > Show Disabled Devices). If your PC has no Stereo
  Mix option at all, installing a free virtual audio cable (e.g. VB-Audio
  Virtual Cable) and selecting that gives you the same result.

ABOUT OCCASIONAL FREEZING / STUTTERING
  This stream is plain UDP with no retransmission (that's what keeps it
  fast and simple), so if a packet ever gets dropped -- normal, occasional
  Wi-Fi behavior -- the picture can freeze or glitch until the next
  keyframe arrives. This app sends a keyframe twice a second so any such
  hiccup should clear itself within about half a second on its own. If
  freezing keeps happening: try lowering Bitrate or Width (less data to
  push over Wi-Fi), or put the TV on Ethernet if possible.

  This app also explicitly binds the outgoing stream to your PC's local
  network IP address, so this is guaranteed to be local-network traffic
  only -- it never touches your internet connection, uses zero internet
  data, and works even if your internet is down, regardless of how many
  network adapters (Wi-Fi, Ethernet, VPN, etc.) your PC has.

IF THE PICTURE LOOKS CROPPED / ZOOMED IN
  Windows display scaling (125%, 150%, 175% -- the default on most
  laptops and 4K monitors) makes Windows report fake, scaled-down screen
  sizes to programs that haven't opted out. ffmpeg captures in real
  pixels, so mixing the two means capturing only the top-left corner of
  the screen. This app now declares itself DPI-aware at startup, so the
  capture area matches your real screen. If you ever still see a cropped
  picture, click "Detect monitors" again -- the sizes listed there should
  match your monitors' real resolutions (e.g. 1920x1080, not 1280x720).

GETTING A SMOOTH 1920x1080 AT 60FPS
  The single biggest factor is the "Capture method" setting.

  GDI (the classic method, and the only one earlier versions of this app
  used) copies every frame through your CPU. At 1920x1080 that's about
  8 MB per frame -- roughly half a gigabyte per second at 60fps. Many PCs
  simply cannot sustain that, so the frame rate collapses, and it gets
  worse when the CPU is also servicing a live audio device.

  Desktop Duplication asks Windows for the finished frame straight from
  the GPU. With an NVIDIA GPU at your screen's native size, the frame
  never leaves the graphics card: capture and encode both happen there,
  with no round trip through system memory. That's what makes 1080p60
  realistic.

  Leave Capture method on "Auto" and the app tests Desktop Duplication
  when you press Start, using it if it works and falling back to GDI
  otherwise. The log always says which one is in use. Use the "1080p60
  (smoothest)" quality preset to set width, frame rate and bitrate in one
  click.

IF SOUND AND PICTURE ARE OUT OF STEP
  Two separate things matter here.

  First, how much latency the audio capture itself adds. DirectShow hands
  audio over in chunks and nothing can be sent until a chunk is full, so
  the chunk size is a hard latency floor. Device defaults are often 500ms
  -- enough on its own to put sound clearly behind picture. This app asks
  for 50ms chunks instead (AUDIO_BUFFER_MS near the top of this file).
  Raise it to 80 or 120 if audio ever crackles or drops out.

  Second, whatever gap is left over, corrected with the "Sync (ms)" box
  next to the audio settings. Work out which one is late first, because
  the sign depends on it:
    - Sound arrives AFTER the picture -> NEGATIVE number (e.g. -200),
      which pulls audio earlier.
    - Sound arrives BEFORE the picture -> POSITIVE number (e.g. 200),
      which holds audio back.
  Adjust by 100 until the gap closes, then by 25. If a change makes it
  clearly worse, the sign is backwards.

  The shipped default is -112, which is what this setup measured out at.
  It is not a universal figure -- it depends on how long a particular TV
  buffers video before displaying it -- so on different hardware, retune
  it. Whatever you set is saved when you press Start, and the stream must
  be restarted for a change to take effect.

IF VIDEO GOES SLOW/CHOPPY ONLY WHEN AUDIO IS TURNED ON
  This one bit hard, so it's worth writing down. Combining two live
  capture devices (screen + sound) tempts you into using ffmpeg's global
  timestamp and frame-pacing options to keep them in sync
  (-use_wallclock_as_timestamps, -max_interleave_delta, -fps_mode,
  -async). Those options act on the *video* stream too, and they can
  throttle it down to a slideshow the moment a second stream exists.

  The video half of the command this app builds is now byte-for-byte
  identical whether or not audio is included -- turning audio on only
  appends a second input and the audio codec settings. Audio drift is
  corrected purely on the audio side (by resampling audio), which can
  never slow video down.

  None of this is related to your internet connection or router speed.
  If audio still costs you frame rate, the remaining suspect is CPU load:
  check the encoder shown above the log, and if it says libx264 rather
  than a GPU encoder, see the encoder section above.
"""

import ipaddress
import json
import queue
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import tkinter as tk
import urllib.request
import webbrowser
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tkinter import ttk, messagebox

VB_CABLE_URL = "https://vb-audio.com/Cable/"

# How large a chunk of audio DirectShow should hand over at a time, in
# milliseconds. This is the dominant source of audio latency in this
# pipeline: the device cannot deliver anything until the chunk is full, so
# the chunk size is a latency floor. Device defaults are often 500ms, which
# is enough on its own to put sound noticeably behind picture. 50ms is low
# enough to be imperceptible while staying comfortably above the point
# where virtual cables start glitching.
AUDIO_BUFFER_MS = 50

NO_WINDOW_FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0)

CONFIG_PATH = Path(__file__).with_name("tv_stream_gui_config.json")

DEFAULTS = {
    "tv_ip": "192.168.1.50",
    "tv_port": "1234",
    "bitrate_kbps": "8000",
    "scale_width": "1920",
    "fps": "60",
    "ffmpeg_path": "ffmpeg",
    "include_audio": False,
    "audio_device": "",
    "encoder_pref": "auto",
    "capture_method": "auto",
    # Tuned by ear against the TV this app is used with: audio was landing
    # after the picture, so it gets pulled 112ms earlier. This is a
    # property of that specific TV's video buffering, not a universal
    # constant -- on a different TV, retune it with the "Sync (ms)" box.
    "audio_delay_ms": "-112",
}

# Hardware encoders to try, in order, each with the extra args that make it
# behave like a real-time low-latency encoder.
HARDWARE_ENCODERS = [
    # p1 is NVENC's fastest but lowest-quality preset. Now that capture is
    # GPU-direct there is plenty of headroom, and p4 at the same bitrate
    # looks noticeably cleaner on motion (less blocking / "chunkiness")
    # while still being a low-latency preset.
    # no-scenecut stops NVENC inserting *extra* unscheduled keyframes when
    # the picture changes a lot -- those show up as periodic data bursts
    # that a Wi-Fi link can drop, which reads as a stutter.
    # rc-lookahead 0 and delay 0 keep frames from being held back for
    # analysis, which is what you want for a live stream.
    ("h264_nvenc", ["-preset", "p4", "-tune", "ll", "-rc", "cbr",
                     "-rc-lookahead", "0", "-delay", "0",
                     "-no-scenecut", "1", "-forced-idr", "1"]),
    ("h264_qsv", ["-preset", "veryfast"]),
    ("h264_amf", ["-usage", "ultralowlatency"]),
]
SOFTWARE_ENCODER = ("libx264", ["-preset", "ultrafast", "-tune", "zerolatency"])
ENCODER_ARGS_BY_NAME = {name: args for name, args in HARDWARE_ENCODERS}

# Stripped-back options for each hardware encoder, used only if the tuned
# set above is rejected. The tuned options improve smoothness but are
# encoder-private, so an older GPU driver or an ffmpeg build compiled
# without one of them would fail the test encode -- and silently dropping
# someone to slow CPU encoding over a single unsupported flag would be a
# bad trade. Falling back to the basics keeps them on the GPU.
SAFE_ENCODER_ARGS = {
    "h264_nvenc": ["-preset", "p4", "-tune", "ll", "-rc", "cbr"],
    "h264_qsv": ["-preset", "veryfast"],
    "h264_amf": ["-usage", "ultralowlatency"],
}

# How the screen itself gets captured.
#   gdigrab  -- the classic GDI screen copy. Works everywhere, but every
#               frame is copied through the CPU, which is why it struggles
#               to sustain 1080p60 -- and why it degrades further when
#               ffmpeg also has a live audio device to service.
#   ddagrab  -- Windows Desktop Duplication API. The GPU hands over the
#               finished frame directly, so the CPU barely participates.
#               This is what makes 1080p60 realistic. Needs Windows 8+
#               and a reasonably recent ffmpeg build.
CAPTURE_CHOICES = [
    ("Auto (recommended)", "auto"),
    ("Desktop Duplication (GPU, fastest)", "ddagrab"),
    ("GDI (most compatible)", "gdigrab"),
]

# (display text shown in the GUI dropdown, internal value passed to
# detect_encoder / saved in the config file).
ENCODER_CHOICES = [
    ("Auto (recommended)", "auto"),
    ("NVIDIA GPU (NVENC)", "h264_nvenc"),
    ("Intel GPU (Quick Sync)", "h264_qsv"),
    ("AMD GPU (AMF)", "h264_amf"),
    ("CPU only (software)", "cpu"),
]


def load_config() -> dict:
    cfg = dict(DEFAULTS)
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text()))
        except Exception:
            pass
    return cfg


def save_config(cfg: dict) -> None:
    try:
        CONFIG_PATH.write_text(json.dumps(cfg, indent=2))
    except Exception:
        pass  # non-fatal -- just means settings won't be remembered


# ---------------------------------------------------------------------------
# TV auto-discovery (SSDP / UPnP) -- best-effort. Most smart TVs, including
# generic Android-based ones, run a DLNA/UPnP media renderer service for
# casting purposes and respond to this even if you never use that feature.
# ---------------------------------------------------------------------------
SSDP_MCAST_ADDR = "239.255.255.250"
SSDP_MCAST_PORT = 1900
SSDP_SEARCH_TARGETS = [
    "urn:schemas-upnp-org:device:MediaRenderer:1",
    "upnp:rootdevice",
    "ssdp:all",
]


def ssdp_discover(timeout: float = 3.0) -> list:
    """Returns a list of dicts: {"ip": ..., "location": ..., "name": ...}.
    Best-effort -- devices that don't speak SSDP (or have it turned off)
    simply won't show up here, and manual IP entry always still works."""
    found = {}

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    for st in SSDP_SEARCH_TARGETS:
        msg = (
            "M-SEARCH * HTTP/1.1\r\n"
            f"HOST: {SSDP_MCAST_ADDR}:{SSDP_MCAST_PORT}\r\n"
            'MAN: "ssdp:discover"\r\n'
            "MX: 2\r\n"
            f"ST: {st}\r\n"
            "\r\n"
        )
        try:
            sock.sendto(msg.encode(), (SSDP_MCAST_ADDR, SSDP_MCAST_PORT))
        except OSError:
            pass

    deadline = time.time() + timeout
    while True:
        remaining = deadline - time.time()
        if remaining <= 0:
            break
        sock.settimeout(remaining)
        try:
            data, addr = sock.recvfrom(4096)
        except (socket.timeout, OSError):
            break
        ip = addr[0]
        if ip in found:
            continue
        text = data.decode(errors="ignore")
        loc_match = re.search(r"LOCATION:\s*(\S+)", text, re.IGNORECASE)
        location = loc_match.group(1).strip() if loc_match else None
        found[ip] = {"ip": ip, "location": location, "name": None}

    sock.close()

    # Best-effort: fetch each responder's UPnP description XML for a
    # friendly name, so the picker shows more than just a bare IP.
    for ip, info in found.items():
        if not info["location"]:
            continue
        try:
            with urllib.request.urlopen(info["location"], timeout=2.0) as resp:
                xml_data = resp.read()
            root = ET.fromstring(xml_data)
            ns = {"d": "urn:schemas-upnp-org:device-1-0"}
            friendly = root.find(".//d:friendlyName", ns)
            manufacturer = root.find(".//d:manufacturer", ns)
            parts = []
            if friendly is not None and friendly.text:
                parts.append(friendly.text.strip())
            if manufacturer is not None and manufacturer.text:
                parts.append(f"({manufacturer.text.strip()})")
            if parts:
                info["name"] = " ".join(parts)
        except Exception:
            pass  # leave name as None -- picker shows "Unknown device"

    return list(found.values())


# ---------------------------------------------------------------------------
# Full network device scan (IP + MAC + hostname) -- a broader fallback when
# SSDP doesn't find the TV. Pings every address in the local /24 (which
# populates Windows' ARP cache), then reads that cache with `arp -a` and
# fills in a reverse-DNS hostname where one exists. This lists EVERY device
# on the LAN, not just the TV, so the app shows it in a searchable table
# and lets you pick the right one by IP, MAC, or hostname.
# ---------------------------------------------------------------------------
ARP_LINE_RE = re.compile(
    r"^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-fA-F-]{17})\s+(\w+)", re.MULTILINE
)


def guess_local_subnet() -> tuple:
    """Returns (local_ip, subnet_cidr), guessing a /24 around the local IP --
    correct for the vast majority of home networks."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
    except Exception:
        local_ip = "127.0.0.1"
    finally:
        s.close()
    parts = local_ip.split(".")
    subnet = f"{parts[0]}.{parts[1]}.{parts[2]}.0/24"
    return local_ip, subnet


def _ping_once(ip: str, timeout_ms: int = 300) -> bool:
    try:
        result = subprocess.run(
            ["ping", "-n", "1", "-w", str(timeout_ms), ip],
            capture_output=True, timeout=(timeout_ms / 1000) + 1,
            creationflags=NO_WINDOW_FLAGS,
        )
        return result.returncode == 0
    except Exception:
        return False


def ping_sweep(subnet_cidr: str, max_workers: int = 48, progress_cb=None) -> None:
    """Pings every host in the subnet (in parallel) purely to populate the
    OS's ARP cache -- we don't need the ping results themselves."""
    network = ipaddress.ip_network(subnet_cidr, strict=False)
    hosts = list(network.hosts())
    completed = [0]

    def task(ip):
        _ping_once(str(ip))
        completed[0] += 1
        if progress_cb and completed[0] % 24 == 0:
            progress_cb(completed[0], len(hosts))

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        list(ex.map(task, hosts))
    if progress_cb:
        progress_cb(len(hosts), len(hosts))


def _is_real_device_mac(mac: str) -> bool:
    if mac in ("ff:ff:ff:ff:ff:ff", "00:00:00:00:00:00"):
        return False
    if mac.startswith("01:00:5e") or mac.startswith("33:33"):
        return False
    return True


def get_arp_table() -> list:
    """Parses `arp -a` (Windows) into a list of {"ip", "mac", "type"} dicts,
    filtering out broadcast/multicast noise entries."""
    try:
        result = subprocess.run(
            ["arp", "-a"], capture_output=True, text=True, timeout=10,
            creationflags=NO_WINDOW_FLAGS,
        )
        output = result.stdout
    except Exception:
        return []

    entries = []
    for match in ARP_LINE_RE.finditer(output):
        ip, mac, typ = match.groups()
        mac_norm = mac.replace("-", ":").lower()
        if not _is_real_device_mac(mac_norm):
            continue
        entries.append({"ip": ip, "mac": mac_norm, "type": typ})
    return entries


def _reverse_lookup(ip: str, timeout: float = 0.5) -> str:
    old_timeout = socket.getdefaulttimeout()
    socket.setdefaulttimeout(timeout)
    try:
        name, _, _ = socket.gethostbyaddr(ip)
        return name
    except Exception:
        return ""
    finally:
        socket.setdefaulttimeout(old_timeout)


def scan_network_devices(progress_cb=None) -> list:
    """Full scan: ping sweep the local /24, read the ARP table, add reverse
    DNS hostnames where available. Returns a list of {"ip","mac","hostname"}
    sorted by IP, restricted to the subnet actually swept."""
    local_ip, subnet = guess_local_subnet()
    ping_sweep(subnet, progress_cb=progress_cb)
    arp_entries = get_arp_table()

    network = ipaddress.ip_network(subnet, strict=False)
    in_subnet = []
    for entry in arp_entries:
        try:
            if ipaddress.ip_address(entry["ip"]) in network:
                in_subnet.append(entry)
        except ValueError:
            continue

    with ThreadPoolExecutor(max_workers=32) as ex:
        hostnames = list(ex.map(_reverse_lookup, [e["ip"] for e in in_subnet]))
    for entry, hostname in zip(in_subnet, hostnames):
        entry["hostname"] = hostname

    in_subnet.sort(key=lambda e: tuple(int(p) for p in e["ip"].split(".")))
    return in_subnet


# ---------------------------------------------------------------------------
# Monitor selection -- lets you pick which screen to stream when you have
# more than one. Uses the Windows EnumDisplayMonitors API directly via
# ctypes (stdlib-only, no extra installs) to get each monitor's position
# and size in virtual-desktop coordinates, which gdigrab can then be told
# to crop to via -offset_x/-offset_y/-video_size.
# ---------------------------------------------------------------------------
def enable_dpi_awareness():
    """Windows only, and important: call this before enumerating monitors.

    If Windows display scaling is set above 100% (the default on most
    laptops and on almost every 4K monitor -- 125%, 150%, 175%) then a
    process that hasn't declared itself DPI-aware is *lied to* by Windows:
    screen APIs report virtualized "logical" coordinates instead of real
    ones. A real 1920x1080 screen at 150% scaling reports itself as
    1280x720.

    ffmpeg's gdigrab, on the other hand, always captures in true physical
    pixels. Mix the two and we hand gdigrab a capture rectangle smaller
    than the screen actually is, so it captures only the top-left corner
    of the screen -- which shows up on the TV as a cropped / zoomed-in
    picture.

    Declaring the process DPI-aware makes Windows report real pixel
    coordinates, so the capture rectangle matches the physical screen."""
    if sys.platform != "win32":
        return
    try:
        import ctypes
    except Exception:
        return

    # Try the most correct API first and fall back on older Windows.
    # PER_MONITOR_AWARE_V2 (-4) reports true pixels even when different
    # monitors run at different scaling factors.
    try:
        if ctypes.windll.user32.SetProcessDpiAwarenessContext(-4):
            return
    except Exception:
        pass
    try:
        # 2 == PROCESS_PER_MONITOR_DPI_AWARE; returns S_OK (0) on success.
        if ctypes.windll.shcore.SetProcessDpiAwareness(2) == 0:
            return
    except Exception:
        pass
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass


def enumerate_monitors() -> list:
    """Returns a list of {"left","top","width","height"} dicts, one per
    connected monitor, in virtual-desktop coordinates. Returns an empty
    list on anything other than Windows, or if the API call fails --
    callers should treat that as "just capture everything" (all monitors).

    Note: enable_dpi_awareness() must have run first, otherwise these
    numbers come back scaled-down on any display using >100% scaling and
    the captured region ends up cropped. See that function for details."""
    if sys.platform != "win32":
        return []
    try:
        import ctypes
        from ctypes import wintypes

        monitors = []

        def _callback(hMonitor, hdcMonitor, lprcMonitor, dwData):
            r = lprcMonitor.contents
            monitors.append({
                "left": r.left, "top": r.top,
                "width": r.right - r.left, "height": r.bottom - r.top,
            })
            return 1

        MonitorEnumProc = ctypes.WINFUNCTYPE(
            ctypes.c_int, wintypes.HMONITOR, wintypes.HDC,
            ctypes.POINTER(wintypes.RECT), wintypes.LPARAM,
        )
        ctypes.windll.user32.EnumDisplayMonitors(
            None, None, MonitorEnumProc(_callback), 0
        )
        return monitors
    except Exception:
        return []


def monitor_label(index: int, mon: dict) -> str:
    return f"Monitor {index + 1} — {mon['width']}x{mon['height']} @ ({mon['left']},{mon['top']})"


ALL_MONITORS_LABEL = "All monitors (full virtual desktop)"


# ---------------------------------------------------------------------------
# Desktop audio (optional) -- Windows has no single universal "system audio"
# input; ffmpeg captures it via a named DirectShow audio device. On most
# PCs that means enabling the hidden "Stereo Mix" recording device (Sound
# settings > Recording tab > right-click > Show Disabled Devices), or
# installing a free virtual audio cable (e.g. VB-Audio Virtual Cable) if
# your sound card has no loopback device at all. This helper lists whatever
# DirectShow audio devices ffmpeg can already see, so you don't have to
# guess the exact device name/string.
# ---------------------------------------------------------------------------
def list_dshow_audio_devices(ffmpeg: str) -> tuple:
    """Parses `ffmpeg -list_devices true -f dshow -i dummy` and returns
    (devices, raw_output) -- devices is the list of audio device names
    found (empty on non-Windows or on failure), raw_output is ffmpeg's
    full stderr text so a zero-result case can still be diagnosed (e.g.
    Windows blocking desktop apps from seeing recording devices at all,
    which looks identical to "no devices exist" unless you see the raw
    ffmpeg output)."""
    try:
        result = subprocess.run(
            [ffmpeg, "-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
            capture_output=True, text=True, timeout=15, creationflags=NO_WINDOW_FLAGS,
        )
        output = result.stderr  # ffmpeg logs device listings to stderr
    except Exception as exc:
        return [], f"(failed to run ffmpeg: {exc})"

    # Different ffmpeg builds format this differently. Older/some builds
    # print two section headers ("DirectShow video devices" / "DirectShow
    # audio devices") followed by plain quoted device names. Newer builds
    # instead tag each device inline on its own line, e.g.
    # `"Stereo Mix (Realtek(R) Audio)" (audio)`, with no section headers
    # at all. Handle both so a format difference can't silently produce a
    # false "no devices" result.
    devices = []
    in_audio_section = False
    for line in output.splitlines():
        if "DirectShow audio devices" in line:
            in_audio_section = True
            continue
        if "DirectShow video devices" in line:
            in_audio_section = False
            continue
        if "Alternative name" in line:
            continue

        inline_match = re.search(r'"([^"]+)"\s*\(audio\)\s*$', line)
        if inline_match:
            name = inline_match.group(1)
            if name not in devices:
                devices.append(name)
            continue

        if in_audio_section:
            match = re.search(r'"([^"]+)"', line)
            if match and match.group(1) not in devices:
                devices.append(match.group(1))
    return devices, output


def get_local_ip(target_ip: str) -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect((target_ip, 80))
        return s.getsockname()[0]
    except Exception:
        return "(unknown -- check network connection)"
    finally:
        s.close()


def _test_encoder(ffmpeg: str, name: str, extra_args: list):
    """Throwaway 5-frame test encode. Returns (worked: bool, error_detail: str)
    -- error_detail is ffmpeg's last stderr line (or exception text) so a
    failure can be explained rather than just silently skipped."""
    test_cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30",
        "-frames:v", "5",
        "-c:v", name, *extra_args,
        "-f", "null", "-",
    ]
    try:
        result = subprocess.run(test_cmd, capture_output=True, text=True, timeout=15)
        if result.returncode == 0:
            return True, ""
        detail = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else ""
        return False, detail
    except Exception as exc:
        return False, str(exc)


def _working_args_for(ffmpeg: str, name: str, log_fn=None) -> tuple:
    """Returns (args, detail): the tuned options for this encoder if they
    test clean, otherwise the stripped-back options if those work, or
    (None, reason) if the encoder can't be used at all here."""
    tuned = ENCODER_ARGS_BY_NAME.get(name, [])
    ok, detail = _test_encoder(ffmpeg, name, tuned)
    if ok:
        return tuned, ""
    safe = SAFE_ENCODER_ARGS.get(name)
    if safe and safe != tuned:
        ok_safe, detail_safe = _test_encoder(ffmpeg, name, safe)
        if ok_safe:
            if log_fn:
                log_fn(
                    f"{name}: some tuning options weren't accepted -- using "
                    "basic settings instead (still GPU-encoded).\n"
                )
            return safe, ""
        detail = detail_safe or detail
    return None, detail


def detect_encoder(ffmpeg: str, preference: str = "auto", log_fn=None):
    """Pick an encoder to use.
    preference:
      "auto" (default) -- try each GPU encoder in HARDWARE_ENCODERS order,
        use the first one that actually works, fall back to software if
        none do. This already prefers the GPU with no user input needed.
      "cpu" -- always use software encoding (libx264), skip GPU entirely.
      a specific hardware encoder name, e.g. "h264_nvenc" -- test only that
        one GPU encoder (used when the user explicitly picks a GPU vendor
        in the UI instead of leaving it on Auto); if it doesn't actually
        work on this PC, fall back to software and log why, rather than
        silently trying a different GPU vendor's encoder the user didn't
        select.
    Returns (name, extra_args)."""
    if preference == "cpu":
        if log_fn:
            log_fn("Encoder: CPU only selected -- using software encoding (libx264).\n")
        return SOFTWARE_ENCODER

    if preference != "auto" and preference in ENCODER_ARGS_BY_NAME:
        args, detail = _working_args_for(ffmpeg, preference, log_fn)
        if args is not None:
            if log_fn:
                log_fn(f"Using requested GPU encoder: {preference}\n")
            return preference, args
        if log_fn:
            reason = f" ({detail})" if detail else ""
            log_fn(
                f"Requested GPU encoder '{preference}' isn't usable on this "
                f"PC{reason} -- falling back to software encoding (libx264). "
                "This usually means that GPU vendor's driver isn't installed, "
                "there's no matching GPU in this PC, or this ffmpeg build "
                "wasn't compiled with support for it.\n"
            )
        return SOFTWARE_ENCODER

    # "auto" (or an unrecognized value) -- try every GPU encoder in order,
    # use the first one that actually works.
    for name, _extra_args in HARDWARE_ENCODERS:
        args, _detail = _working_args_for(ffmpeg, name, log_fn)
        if args is not None:
            if log_fn:
                log_fn(f"Hardware encoder available: {name}\n")
            return name, args
    if log_fn:
        log_fn("No hardware encoder found -- will use software encoding (libx264).\n")
    return SOFTWARE_ENCODER


def _video_encode_args(encoder: str, encoder_args: list, rate: int,
                        bufsize: int, gop: int, gpu_direct: bool) -> list:
    """The video encoding options. Identical regardless of whether audio is
    included -- see the design rule in build_command."""
    args = [
        "-c:v", encoder, *encoder_args,
        "-g", str(gop), "-bf", "0",
        "-b:v", f"{rate}k",
        "-maxrate", f"{rate}k",
        "-bufsize", f"{bufsize}k",
    ]
    if not gpu_direct:
        # When frames are in normal system memory we pin the pixel format
        # explicitly. On the GPU-direct path the frames never leave the
        # GPU, so forcing a pixel format here would drag them back into
        # system memory and undo the whole point.
        args += ["-pix_fmt", "yuv420p"]
    if encoder == "libx264":
        # Resend stream headers with every keyframe so a TV joining late
        # (or recovering from a dropped packet) can start decoding at the
        # next keyframe. Only x264 understands this option.
        args += ["-x264-params", "repeat-headers=1"]
    return args


def build_ddagrab_filter(fps: str, monitor_index: int, scale_width: str,
                          monitor: dict, gpu_direct: bool) -> str:
    """The filter chain for Desktop Duplication capture.

    ddagrab is a *source* filter: it produces frames rather than consuming
    an -i input, and it hands them over as GPU (d3d11) frames. If the
    encoder can take GPU frames directly and no resizing is needed, we
    leave them on the GPU end to end -- capture, encode, done, with the
    CPU barely involved. Otherwise we pull them back into system memory
    (hwdownload) to resize and/or feed a CPU encoder."""
    idx = monitor_index if monitor_index is not None else 0
    chain = f"ddagrab=output_idx={idx}:framerate={fps}:draw_mouse=1"
    if gpu_direct:
        return chain + "[v]"
    chain += ",hwdownload,format=bgra"
    if _needs_scaling(scale_width, monitor):
        chain += f",scale={scale_width}:-2:flags=fast_bilinear"
    return chain + ",format=yuv420p[v]"


def _needs_scaling(scale_width: str, monitor: dict) -> bool:
    """True when the requested output width actually differs from what we
    are capturing. Scaling a 1920-wide capture to 1920 wide is pure wasted
    work, and at 60fps that waste is significant."""
    if not monitor:
        return True  # unknown source size -- scale to be safe
    try:
        return int(scale_width) != int(monitor["width"])
    except (TypeError, ValueError, KeyError):
        return True


def build_command(ffmpeg: str, encoder: str, encoder_args: list,
                   tv_ip: str, tv_port: str, bitrate_kbps: str,
                   scale_width: str, fps: str,
                   monitor: dict = None, audio_device: str = None,
                   local_ip: str = None, capture: str = "gdigrab",
                   monitor_index: int = None, audio_delay_ms: int = 0) -> list:
    """Builds the ffmpeg command line.

    capture: "gdigrab" (CPU screen copy, works everywhere) or "ddagrab"
    (Windows Desktop Duplication -- the GPU hands frames over directly,
    which is what makes 1080p60 achievable).
    monitor: {"left","top","width","height"} to crop capture to a single
    screen, or None for the whole virtual desktop. Used by gdigrab. These
    MUST be true physical-pixel coordinates -- see enable_dpi_awareness(),
    or the capture comes out cropped.
    monitor_index: which display to capture, used by ddagrab (which picks a
    display by index rather than by pixel rectangle).
    audio_device: a DirectShow audio device name, or None for video-only.
    audio_delay_ms: shifts audio relative to video to fix lip-sync. The
    video path is inherently slower end to end than the audio path -- the
    TV buffers and decodes video before displaying it, while audio arrives
    almost immediately -- so sound usually lands ahead of picture and a
    POSITIVE value (delaying audio) is what lines them up. Negative values
    pull audio earlier for the rarer opposite case. Applied with
    -itsoffset on the audio input, which shifts that input's timestamps
    without touching video at all.
    local_ip: this PC's LAN IP, bound explicitly via ffmpeg's `localaddr`
    option so the stream provably leaves by the local network adapter and
    never touches the internet.

    DESIGN RULE, learned the hard way: the video half of this command is
    byte-for-byte identical whether or not audio is included. Adding audio
    only ever appends an input and the audio codec options -- it never
    changes a single video option. Earlier versions tried to fix A/V sync
    with global timestamp and frame-pacing options
    (-use_wallclock_as_timestamps, -max_interleave_delta, -fps_mode,
    -async). Those act on the *video* stream too and can throttle it to a
    slideshow the moment a second stream exists. Audio drift is now
    corrected purely on the audio side with aresample, which cannot slow
    video down. If sync needs attention again, fix it in the audio filter
    -- do not reintroduce global timestamp or frame-pacing options."""
    # A keyframe twice a second means a dropped packet or a briefly
    # overwhelmed TV decoder only costs ~0.5s before the picture recovers.
    gop = max(1, int(int(fps) / 2))

    # A bitrate ceiling plus a small buffer stops the encoder emitting
    # occasional huge bursts that Wi-Fi would drop (seen as a freeze).
    rate = int(bitrate_kbps)
    # One second of rate-control buffer. The previous half-second window was
    # tight enough that busy frames forced sharp quality drops, which looks
    # like the picture pulsing between crisp and blocky.
    bufsize = max(1, rate)

    use_dda = (capture == "ddagrab")
    # nvenc can consume GPU frames directly; the others cannot. Combined
    # with "no resize needed", that unlocks a fully on-GPU pipeline.
    gpu_direct = use_dda and encoder == "h264_nvenc" and not _needs_scaling(scale_width, monitor)

    cmd = [ffmpeg, "-hide_banner", "-loglevel", "warning"]

    audio_input = []
    if audio_device:
        audio_input = []
        if audio_delay_ms:
            # Must come before -i to apply to that input.
            audio_input += ["-itsoffset", f"{audio_delay_ms / 1000.0:.3f}"]
        audio_input += [
            "-f", "dshow",
            "-thread_queue_size", "1024",
            # THE reason captured audio arrives late. DirectShow hands audio
            # over in chunks, and the chunk size *is* the latency: nothing
            # can be sent until the buffer fills. ffmpeg leaves this at the
            # device's own default, which is commonly 500ms -- half a second
            # of audio lag before anything else in the pipeline has even
            # started. Asking for small chunks cuts that to roughly this
            # many milliseconds. If audio ever crackles or drops out, this
            # is the number to raise (80, then 120).
            "-audio_buffer_size", str(AUDIO_BUFFER_MS),
            # A cap, not a target -- room for the device to deliver audio in
            # bursts without ffmpeg reporting a full real-time buffer and
            # dropping samples. Deliberately not huge: if the pipeline ever
            # did fall behind, an oversized cap would let audio queue up
            # into a growing delay instead of failing fast and visibly.
            "-rtbufsize", "16M",
            "-i", f"audio={audio_device}",
        ]

    if use_dda:
        cmd += ["-init_hw_device", "d3d11va"]
        # ddagrab produces video from a filter, so the audio device (when
        # present) is input 0.
        cmd += audio_input
        fc = build_ddagrab_filter(fps, monitor_index, scale_width, monitor, gpu_direct)
        cmd += ["-filter_complex", fc, "-map", "[v]"]
        if audio_device:
            cmd += ["-map", "0:a"]
        cmd += _video_encode_args(encoder, encoder_args, rate, bufsize, gop, gpu_direct)
    else:
        video_input = [
            "-f", "gdigrab",
            "-framerate", str(fps),
            # Room for the capture thread so a momentary stall elsewhere in
            # the pipeline doesn't cost captured frames.
            "-thread_queue_size", "1024",
        ]
        if monitor:
            video_input += [
                "-offset_x", str(monitor["left"]), "-offset_y", str(monitor["top"]),
                "-video_size", f"{monitor['width']}x{monitor['height']}",
            ]
        video_input += ["-i", "desktop"]
        cmd += video_input + audio_input
        if audio_device:
            cmd += ["-map", "0:v", "-map", "1:a"]
        if _needs_scaling(scale_width, monitor):
            cmd += ["-vf", f"scale={scale_width}:-2:flags=fast_bilinear"]
        cmd += _video_encode_args(encoder, encoder_args, rate, bufsize, gop, gpu_direct)

    if audio_device:
        cmd += [
            "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000",
            # Corrects drift on the AUDIO stream only, by stretching or
            # padding samples. Video is never touched, so this cannot
            # cause the frame-rate collapse the old options did.
            "-af", "aresample=async=1000",
        ]

    udp_url = f"udp://{tv_ip}:{tv_port}?pkt_size=1316"
    if local_ip:
        udp_url += f"&localaddr={local_ip}"
    # muxdelay/muxpreload 0 stop the TS muxer pre-buffering before it
    # starts sending -- shaves startup latency off a live stream.
    cmd += ["-f", "mpegts", "-muxdelay", "0", "-muxpreload", "0", udp_url]
    return cmd


def test_ddagrab(ffmpeg: str, monitor_index: int = 0) -> tuple:
    """Checks whether Desktop Duplication capture actually works here
    before we commit a live stream to it. Returns (works, detail).

    ddagrab needs Windows 8+, a recent ffmpeg build, and a GPU/driver that
    exposes the Desktop Duplication API. It also refuses to run in some
    remote-desktop sessions. Rather than guess, encode three throwaway
    frames and see."""
    if sys.platform != "win32":
        return False, "not Windows"
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error",
        "-init_hw_device", "d3d11va",
        "-filter_complex", f"ddagrab=output_idx={monitor_index}:framerate=30",
        "-frames:v", "3", "-f", "null", "-",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True,
                                 timeout=20, creationflags=NO_WINDOW_FLAGS)
        if result.returncode == 0:
            return True, ""
        detail = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else ""
        return False, detail
    except Exception as exc:
        return False, str(exc)


class StreamerApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Desktop -> TV Streamer")
        self.root.geometry("940x760")
        self.root.minsize(880, 560)

        self.cfg = load_config()
        self.proc = None
        self.reader_thread = None
        self.log_queue = queue.Queue()

        self._build_widgets()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.after(100, self._drain_log_queue)
        self.root.after(200, self._detect_monitors_clicked)

    # ---------------------------------------------------------------- UI --
    def _build_widgets(self):
        pad = {"padx": 6, "pady": 4}

        form = ttk.Frame(self.root)
        form.pack(fill="x", **pad)

        self.vars = {}

        def add_field(row, key, label, width=18):
            ttk.Label(form, text=label).grid(row=row, column=0, sticky="w", **pad)
            var = tk.StringVar(value=self.cfg.get(key, DEFAULTS[key]))
            entry = ttk.Entry(form, textvariable=var, width=width)
            entry.grid(row=row, column=1, sticky="w", **pad)
            self.vars[key] = var
            return entry

        tv_ip_entry = add_field(0, "tv_ip", "TV IP address:")
        self.scan_btn = ttk.Button(form, text="Scan for TV", command=self._scan_clicked)
        self.scan_btn.grid(row=0, column=2, sticky="w", **pad)
        self.devices_btn = ttk.Button(form, text="Network devices", command=self._show_devices_clicked)
        self.devices_btn.grid(row=0, column=3, sticky="w", **pad)
        add_field(1, "tv_port", "TV port:", width=8)
        add_field(2, "bitrate_kbps", "Bitrate (kbps):", width=8)
        add_field(3, "scale_width", "Width (px):", width=8)
        add_field(4, "fps", "FPS:", width=8)
        add_field(5, "ffmpeg_path", "ffmpeg path (usually fine as-is):")

        # Monitor selection
        ttk.Label(form, text="Screen to stream:").grid(row=6, column=0, sticky="w", **pad)
        self.monitor_var = tk.StringVar(value=ALL_MONITORS_LABEL)
        self.monitor_combo = ttk.Combobox(
            form, textvariable=self.monitor_var, state="readonly", width=26,
            values=[ALL_MONITORS_LABEL],
        )
        self.monitor_combo.grid(row=6, column=1, sticky="w", **pad)
        ttk.Button(form, text="Detect monitors", command=self._detect_monitors_clicked).grid(
            row=6, column=2, sticky="w", **pad
        )
        self.monitors_by_label = {}  # label -> monitor dict
        self.monitor_index_by_label = {}  # label -> display index (for ddagrab)

        # Audio
        ttk.Label(form, text="Desktop audio:").grid(row=7, column=0, sticky="w", **pad)
        self.include_audio_var = tk.BooleanVar(value=self.cfg.get("include_audio", False))
        ttk.Checkbutton(
            form, text="Include", variable=self.include_audio_var,
            command=self._toggle_audio_device_state,
        ).grid(row=7, column=1, sticky="w", **pad)
        self.audio_device_var = tk.StringVar(value=self.cfg.get("audio_device", ""))
        self.audio_combo = ttk.Combobox(
            form, textvariable=self.audio_device_var, state="disabled", width=26,
            values=([self.audio_device_var.get()] if self.audio_device_var.get() else []),
        )
        self.audio_combo.grid(row=7, column=2, sticky="w", **pad)
        ttk.Button(form, text="List audio devices", command=self._list_audio_clicked).grid(
            row=7, column=3, sticky="w", **pad
        )
        self._toggle_audio_device_state()

        audio_help_frame = ttk.Frame(form)
        audio_help_frame.grid(row=8, column=1, columnspan=3, sticky="w", padx=6)
        ttk.Label(audio_help_frame, text="Sync (ms):").pack(side="left")
        self.vars["audio_delay_ms"] = tk.StringVar(
            value=str(self.cfg.get("audio_delay_ms", "0"))
        )
        ttk.Entry(
            audio_help_frame, textvariable=self.vars["audio_delay_ms"], width=6
        ).pack(side="left", padx=(4, 2))
        ttk.Button(
            audio_help_frame, text="?", width=2, command=self._show_sync_help,
        ).pack(side="left", padx=(0, 10))
        ttk.Button(
            audio_help_frame, text="One app only, or everything? (help)",
            command=self._show_audio_help,
        ).pack(side="left")
        ttk.Button(
            audio_help_frame, text="Get VB-Audio Virtual Cable (free)",
            command=lambda: webbrowser.open(VB_CABLE_URL),
        ).pack(side="left", padx=(6, 0))

        # Encoder (GPU vs CPU) selection
        ttk.Label(form, text="Encoder:").grid(row=9, column=0, sticky="w", **pad)
        self.encoder_display_to_value = dict(ENCODER_CHOICES)
        self.encoder_value_to_display = {v: d for d, v in ENCODER_CHOICES}
        saved_encoder_pref = self.cfg.get("encoder_pref", "auto")
        initial_display = self.encoder_value_to_display.get(saved_encoder_pref, ENCODER_CHOICES[0][0])
        self.encoder_var = tk.StringVar(value=initial_display)
        self.encoder_combo = ttk.Combobox(
            form, textvariable=self.encoder_var, state="readonly", width=26,
            values=[display for display, _value in ENCODER_CHOICES],
        )
        self.encoder_combo.grid(row=9, column=1, sticky="w", **pad)
        ttk.Button(
            form, text="GPU encoding (help)",
            command=self._show_encoder_help,
        ).grid(row=9, column=2, sticky="w", **pad)

        # Quality presets -- one click instead of editing four fields, and
        # they override whatever was previously saved in the config file.
        ttk.Label(form, text="Quality preset:").grid(row=10, column=0, sticky="w", **pad)
        preset_frame = ttk.Frame(form)
        preset_frame.grid(row=10, column=1, columnspan=3, sticky="w", padx=6)
        ttk.Button(
            preset_frame, text="1080p60 (smoothest)",
            command=lambda: self._apply_preset("1920", "60", "8000"),
        ).pack(side="left")
        ttk.Button(
            preset_frame, text="1080p30",
            command=lambda: self._apply_preset("1920", "30", "6000"),
        ).pack(side="left", padx=(6, 0))
        ttk.Button(
            preset_frame, text="720p60 (weak Wi-Fi)",
            command=lambda: self._apply_preset("1280", "60", "4000"),
        ).pack(side="left", padx=(6, 0))

        # Capture method
        ttk.Label(form, text="Capture method:").grid(row=11, column=0, sticky="w", **pad)
        self.capture_display_to_value = dict(CAPTURE_CHOICES)
        self.capture_value_to_display = {v: d for d, v in CAPTURE_CHOICES}
        saved_capture = self.cfg.get("capture_method", "auto")
        self.capture_var = tk.StringVar(
            value=self.capture_value_to_display.get(saved_capture, CAPTURE_CHOICES[0][0])
        )
        self.capture_combo = ttk.Combobox(
            form, textvariable=self.capture_var, state="readonly", width=26,
            values=[display for display, _v in CAPTURE_CHOICES],
        )
        self.capture_combo.grid(row=11, column=1, sticky="w", **pad)
        ttk.Button(
            form, text="Capture method (help)",
            command=self._show_capture_help,
        ).grid(row=11, column=2, sticky="w", **pad)

        # VLC connection string + copy button
        vlc_frame = ttk.Frame(self.root)
        vlc_frame.pack(fill="x", **pad)
        ttk.Label(vlc_frame, text="Enter this in VLC's Network Stream on the TV:").pack(side="left")
        self.vlc_string_var = tk.StringVar()
        vlc_entry = ttk.Entry(vlc_frame, textvariable=self.vlc_string_var, width=20, state="readonly")
        vlc_entry.pack(side="left", padx=6)
        ttk.Button(vlc_frame, text="Copy", command=self._copy_vlc_string).pack(side="left")
        self.vars["tv_port"].trace_add("write", lambda *a: self._update_vlc_string())
        self._update_vlc_string()

        # Buttons
        btn_frame = ttk.Frame(self.root)
        btn_frame.pack(fill="x", **pad)
        self.detect_btn = ttk.Button(btn_frame, text="Detect encoder", command=self._detect_encoder_clicked)
        self.detect_btn.pack(side="left", padx=4)
        self.start_btn = ttk.Button(btn_frame, text="Start Streaming", command=self._start_clicked)
        self.start_btn.pack(side="left", padx=4)
        self.stop_btn = ttk.Button(btn_frame, text="Stop", command=self._stop_clicked, state="disabled")
        self.stop_btn.pack(side="left", padx=4)

        # Status
        self.status_var = tk.StringVar(value="Idle")
        ttk.Label(self.root, textvariable=self.status_var, font=("", 10, "bold")).pack(anchor="w", padx=8)

        # Log box
        log_frame = ttk.Frame(self.root)
        log_frame.pack(fill="both", expand=True, padx=6, pady=6)
        self.log_text = tk.Text(log_frame, height=14, wrap="word", state="disabled")
        scroll = ttk.Scrollbar(log_frame, command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scroll.set)
        self.log_text.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

    def _update_vlc_string(self):
        port = self.vars["tv_port"].get().strip() or "1234"
        self.vlc_string_var.set(f"udp://@:{port}")

    def _copy_vlc_string(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.vlc_string_var.get())

    # ------------------------------------------------------------- Utils --
    def _log(self, text: str):
        self.log_queue.put(text)

    def _drain_log_queue(self):
        try:
            while True:
                text = self.log_queue.get_nowait()
                self.log_text.configure(state="normal")
                self.log_text.insert("end", text)
                self.log_text.see("end")
                self.log_text.configure(state="disabled")
        except queue.Empty:
            pass
        self.root.after(100, self._drain_log_queue)

    def _current_settings(self) -> dict:
        return {k: v.get().strip() for k, v in self.vars.items()}

    def _find_ffmpeg(self, ffmpeg_path: str):
        resolved = shutil.which(ffmpeg_path)
        if not resolved:
            messagebox.showerror(
                "ffmpeg not found",
                f"Could not find '{ffmpeg_path}' on PATH.\n\n"
                "Install ffmpeg from https://www.gyan.dev/ffmpeg/builds/ "
                "(the 'essentials' build), add its bin folder to PATH, "
                "or set the full path to ffmpeg.exe in the 'ffmpeg path' field.",
            )
            return None
        return resolved

    # ----------------------------------------------------------- Actions --
    def _detect_encoder_clicked(self):
        settings = self._current_settings()
        ffmpeg = self._find_ffmpeg(settings["ffmpeg_path"])
        if not ffmpeg:
            return
        preference = self._current_encoder_pref()
        self.status_var.set("Detecting encoder...")
        self.detect_btn.configure(state="disabled")

        def worker():
            name, _ = detect_encoder(ffmpeg, preference=preference, log_fn=self._log)
            self.status_var.set(f"Idle (encoder: {name})")
            self.detect_btn.configure(state="normal")

        threading.Thread(target=worker, daemon=True).start()

    def _toggle_audio_device_state(self):
        self.audio_combo.configure(
            state="readonly" if self.include_audio_var.get() else "disabled"
        )

    def _detect_monitors_clicked(self):
        def worker():
            monitors = enumerate_monitors()
            self.root.after(0, lambda: self._apply_monitor_list(monitors))

        threading.Thread(target=worker, daemon=True).start()

    def _apply_monitor_list(self, monitors: list):
        self.monitors_by_label = {ALL_MONITORS_LABEL: None}
        self.monitor_index_by_label = {ALL_MONITORS_LABEL: 0}
        labels = [ALL_MONITORS_LABEL]
        for i, mon in enumerate(monitors):
            label = monitor_label(i, mon)
            labels.append(label)
            self.monitors_by_label[label] = mon
            self.monitor_index_by_label[label] = i
        self.monitor_combo.configure(values=labels)
        if self.monitor_var.get() not in labels:
            self.monitor_var.set(ALL_MONITORS_LABEL)
        if monitors:
            self._log(f"Detected {len(monitors)} monitor(s).\n")
        else:
            self._log("No monitors detected individually -- will capture the "
                       "full virtual desktop (this is also fine with one monitor).\n")

    def _list_audio_clicked(self):
        settings = self._current_settings()
        ffmpeg = self._find_ffmpeg(settings["ffmpeg_path"])
        if not ffmpeg:
            return
        self._log("Listing DirectShow audio devices...\n")

        def worker():
            devices, raw_output = list_dshow_audio_devices(ffmpeg)
            self.root.after(0, lambda: self._apply_audio_device_list(devices, raw_output))

        threading.Thread(target=worker, daemon=True).start()

    def _apply_audio_device_list(self, devices: list, raw_output: str = ""):
        if not devices:
            self._log(
                "No DirectShow audio devices found. If Stereo Mix is already "
                "enabled in Windows Sound settings and it's still not showing "
                "up here, the most common cause is Windows' microphone "
                "privacy toggle blocking classic desktop apps (like ffmpeg) "
                "from seeing ANY recording device -- check Settings > "
                "Privacy & security > Microphone > 'Let desktop apps access "
                "your microphone' is ON.\n\n"
                "Raw ffmpeg output below (paste this back if you need help "
                "diagnosing it further):\n"
                "----------------------------------------\n"
                f"{raw_output.strip()}\n"
                "----------------------------------------\n"
            )
            messagebox.showinfo(
                "No audio devices found",
                "ffmpeg didn't report any DirectShow audio devices.\n\n"
                "If Stereo Mix is already enabled in Windows Sound settings "
                "and still isn't showing up, the most likely cause is "
                "Windows' microphone privacy setting blocking desktop apps "
                "entirely: Settings > Privacy & security > Microphone > "
                "make sure 'Let desktop apps access your microphone' is ON. "
                "This silently hides ALL recording devices from apps like "
                "ffmpeg, even ones enabled in the old Sound Control Panel.\n\n"
                "If your sound card has no Stereo Mix option at all, click "
                "'Get VB-Audio Virtual Cable (free)' instead.\n\n"
                "The exact ffmpeg output has been printed in the log box "
                "below this window, in case it's something else.",
            )
            return
        self.audio_combo.configure(values=devices)
        if not self.audio_device_var.get() or self.audio_device_var.get() not in devices:
            self.audio_device_var.set(devices[0])
        self._log(f"Found {len(devices)} audio device(s): {', '.join(devices)}\n")

    def _show_audio_help(self):
        messagebox.showinfo(
            "One app only, or everything?",
            "This app captures audio from a DEVICE, not from a named "
            "application -- so ffmpeg has no 'just give me Chrome's sound' "
            "option by itself. But you can get either result using a free "
            "virtual audio cable (see the button next to this one) plus "
            "Windows' own per-app audio routing:\n\n"
            "TO CAPTURE EVERYTHING (your whole system's sound):\n"
            "Install VB-Audio Virtual Cable, then set 'CABLE Input' as your "
            "Windows default playback device (Settings > Sound > Output). "
            "Turn on 'Listen to this device' on 'CABLE Input' in the "
            "Recording tab's properties so you still hear things normally. "
            "Then pick 'CABLE Output' in this app's audio device list -- "
            "that captures everything, with nothing to configure per-app.\n\n"
            "TO CAPTURE JUST ONE APPLICATION:\n"
            "Keep your normal speakers as the Windows default. Open "
            "Settings > System > Sound > Volume mixer, find that one app, "
            "and change ITS output device to 'CABLE Input' -- only that "
            "app's sound now flows into the cable while everything else "
            "still plays normally through your speakers. Pick 'CABLE "
            "Output' in this app's audio device list to capture just that "
            "one app.\n\n"
            "Same virtual cable and same device picked here either way -- "
            "the only difference is which Windows setting you point at it.",
        )

    def _apply_preset(self, width: str, fps: str, bitrate: str):
        self.vars["scale_width"].set(width)
        self.vars["fps"].set(fps)
        self.vars["bitrate_kbps"].set(bitrate)
        self._log(f"Preset applied: {width}px wide, {fps}fps, {bitrate}kbps.\n")

    def _show_sync_help(self):
        messagebox.showinfo(
            "Audio sync",
            "First work out which one is late, because the sign depends on "
            "it. Watch something with speech and see whether the mouth "
            "moves before you hear it, or you hear it before the mouth "
            "moves.\n\n"
            "SOUND ARRIVES AFTER THE PICTURE (sound is late):\n"
            "Use a NEGATIVE number, e.g. -200. This pulls the audio "
            "earlier.\n\n"
            "SOUND ARRIVES BEFORE THE PICTURE (picture is late):\n"
            "Use a POSITIVE number, e.g. 200. This holds the audio back.\n\n"
            "The number is milliseconds (1000 = one second). Change it by "
            "100 at a time until the gap closes, then by 25 to fine-tune. "
            "If a change makes it clearly worse, you have the sign "
            "backwards -- flip it.\n\n"
            "The default here (-112) is the value this setup measured "
            "out at -- it is not a universal figure, since it depends on "
            "how long a particular TV buffers video before displaying it. "
            "On a different TV, retune it. Whatever you set is saved when "
            "you press Start, and the stream has to be restarted for a "
            "change to take effect.",
        )

    def _current_capture_pref(self) -> str:
        return self.capture_display_to_value.get(self.capture_var.get(), "auto")

    def _show_capture_help(self):
        messagebox.showinfo(
            "Capture method",
            "This is how the picture gets off your screen in the first "
            "place, and it matters more than anything else for high frame "
            "rates.\n\n"
            "GDI is the classic method. It works on every Windows PC, but "
            "every single frame is copied through your CPU. At 1920x1080 "
            "that's about 8 MB per frame -- roughly half a gigabyte every "
            "second at 60fps. That is why GDI struggles to hold 60fps, and "
            "why it gets noticeably worse when your PC also has to service "
            "a live audio device at the same time.\n\n"
            "Desktop Duplication asks Windows for the finished frame "
            "straight from the GPU instead. Your CPU barely participates, "
            "and if you're using an NVIDIA GPU at your screen's native "
            "size, the frame never leaves the graphics card at all -- it "
            "goes from capture to encoder without a round trip through "
            "system memory. This is what makes a smooth 1080p60 realistic.\n\n"
            "'Auto' tests Desktop Duplication when you press Start and uses "
            "it if it works, falling back to GDI otherwise. Desktop "
            "Duplication needs Windows 8 or newer and a reasonably recent "
            "ffmpeg build, and it can be unavailable inside a remote "
            "desktop session -- so the fallback matters. Whichever method "
            "ends up being used is written into the log.",
        )

    def _current_encoder_pref(self) -> str:
        return self.encoder_display_to_value.get(self.encoder_var.get(), "auto")

    def _show_encoder_help(self):
        messagebox.showinfo(
            "GPU encoding",
            "Encoding video on your GPU instead of your CPU is faster and "
            "puts far less load on the rest of your PC -- important since "
            "this app is already asking your PC to capture your screen in "
            "real time on top of whatever else you're doing.\n\n"
            "'Auto (recommended)' already does this for you: it tries "
            "NVIDIA (NVENC), then Intel (Quick Sync), then AMD (AMF), in "
            "that order, and only drops to slower CPU (software) encoding "
            "if none of those actually work on this PC. For most people "
            "there's nothing to change here.\n\n"
            "Pick a specific GPU only if you have more than one (e.g. a "
            "laptop with both an Intel integrated GPU and an NVIDIA/AMD "
            "discrete one) and want to force which one is used. If the "
            "one you pick turns out not to work on this PC, this app falls "
            "back to CPU encoding automatically and explains why in the "
            "log -- it won't silently fail to stream.\n\n"
            "Whichever encoder ends up active is always shown right above "
            "the log, e.g. 'Streaming (encoder: h264_nvenc)', so you can "
            "always confirm the GPU is really the one doing the work.",
        )

    def _scan_clicked(self):
        self.scan_btn.configure(state="disabled", text="Scanning...")
        self.status_var.set("Scanning network for TV...")
        self._log("Scanning network for SSDP/UPnP devices (3s)...\n")

        def worker():
            try:
                results = ssdp_discover(timeout=3.0)
            except Exception as exc:
                results = []
                self._log(f"Scan failed: {exc}\n")
            self.root.after(0, self._show_scan_results, results)

        threading.Thread(target=worker, daemon=True).start()

    def _show_scan_results(self, results: list):
        self.scan_btn.configure(state="normal", text="Scan for TV")
        self.status_var.set("Idle")

        if not results:
            self._log("No devices responded. Enter the TV's IP manually "
                       "(check its Network/About settings).\n")
            messagebox.showinfo(
                "No devices found",
                "No devices responded to the network scan.\n\n"
                "This can happen if the TV has casting/DLNA turned off, or "
                "your PC and TV are on different network segments. You can "
                "still enter the TV's IP address manually -- check its "
                "Settings > Network (or About > Status) menu.",
            )
            return

        self._log(f"Found {len(results)} device(s).\n")

        picker = tk.Toplevel(self.root)
        picker.title("Select your TV")
        picker.geometry("420x260")
        picker.transient(self.root)

        ttk.Label(
            picker, text="Pick the device that's your TV:"
        ).pack(anchor="w", padx=8, pady=(8, 4))

        listbox = tk.Listbox(picker, height=8)
        listbox.pack(fill="both", expand=True, padx=8, pady=4)

        for r in results:
            label = f"{r['ip']}  —  {r['name'] or 'Unknown device'}"
            listbox.insert("end", label)

        def use_selected():
            sel = listbox.curselection()
            if not sel:
                return
            chosen = results[sel[0]]
            self.vars["tv_ip"].set(chosen["ip"])
            self._log(f"Selected TV IP: {chosen['ip']}\n")
            picker.destroy()

        listbox.bind("<Double-Button-1>", lambda e: use_selected())

        btn_row = ttk.Frame(picker)
        btn_row.pack(fill="x", padx=8, pady=(0, 8))
        ttk.Button(btn_row, text="Use selected", command=use_selected).pack(side="left")
        ttk.Button(btn_row, text="Cancel", command=picker.destroy).pack(side="left", padx=6)

    def _show_devices_clicked(self):
        self.devices_btn.configure(state="disabled")

        win = tk.Toplevel(self.root)
        win.title("Devices on your network")
        win.geometry("560x420")
        win.transient(self.root)

        status_var = tk.StringVar(value="Scanning your network (this can take up to ~15s)...")
        ttk.Label(win, textvariable=status_var).pack(anchor="w", padx=8, pady=(8, 2))

        search_frame = ttk.Frame(win)
        search_frame.pack(fill="x", padx=8, pady=2)
        ttk.Label(search_frame, text="Search:").pack(side="left")
        search_var = tk.StringVar()
        search_entry = ttk.Entry(search_frame, textvariable=search_var)
        search_entry.pack(side="left", fill="x", expand=True, padx=6)

        columns = ("ip", "mac", "hostname")
        tree = ttk.Treeview(win, columns=columns, show="headings", height=14)
        tree.heading("ip", text="IP address")
        tree.heading("mac", text="MAC address")
        tree.heading("hostname", text="Hostname")
        tree.column("ip", width=130)
        tree.column("mac", width=150)
        tree.column("hostname", width=220)
        tree.pack(fill="both", expand=True, padx=8, pady=4)

        all_devices = []  # populated once the scan finishes

        def refresh_table(*_args):
            query = search_var.get().strip().lower()
            tree.delete(*tree.get_children())
            for d in all_devices:
                haystack = f"{d['ip']} {d['mac']} {d.get('hostname', '')}".lower()
                if query and query not in haystack:
                    continue
                tree.insert("", "end", values=(d["ip"], d["mac"], d.get("hostname", "")))

        search_var.trace_add("write", refresh_table)

        def use_selected():
            sel = tree.selection()
            if not sel:
                return
            values = tree.item(sel[0], "values")
            self.vars["tv_ip"].set(values[0])
            self._log(f"Selected TV IP from device list: {values[0]}\n")
            win.destroy()

        tree.bind("<Double-Button-1>", lambda e: use_selected())

        btn_row = ttk.Frame(win)
        btn_row.pack(fill="x", padx=8, pady=(0, 8))
        ttk.Button(btn_row, text="Use selected as TV IP", command=use_selected).pack(side="left")
        ttk.Button(btn_row, text="Rescan", command=lambda: run_scan()).pack(side="left", padx=6)
        ttk.Button(btn_row, text="Close", command=win.destroy).pack(side="left")

        closed = {"value": False}

        def on_close():
            closed["value"] = True
            self.devices_btn.configure(state="normal")
            win.destroy()

        win.protocol("WM_DELETE_WINDOW", on_close)

        def run_scan():
            status_var.set("Scanning your network (this can take up to ~15s)...")
            tree.delete(*tree.get_children())

            def progress(done, total):
                if closed["value"]:
                    return
                self.root.after(0, lambda: (not closed["value"]) and status_var.set(f"Pinging subnet... {done}/{total}"))

            def worker():
                try:
                    devices = scan_network_devices(progress_cb=progress)
                except Exception as exc:
                    if not closed["value"]:
                        self._log(f"Network scan failed: {exc}\n")
                    devices = []

                if closed["value"]:
                    return

                all_devices.clear()
                all_devices.extend(devices)

                def finish():
                    if closed["value"]:
                        return
                    status_var.set(f"Found {len(devices)} device(s). Type to search by IP, MAC, or hostname.")
                    refresh_table()
                    self.devices_btn.configure(state="normal")

                self.root.after(0, finish)

            threading.Thread(target=worker, daemon=True).start()

        run_scan()

    def _start_clicked(self):
        settings = self._current_settings()

        # Basic validation before we touch ffmpeg at all.
        if not settings["tv_ip"]:
            messagebox.showerror("Missing TV IP", "Please enter your TV's IP address.")
            return
        for key, label in (("tv_port", "TV port"), ("bitrate_kbps", "Bitrate"),
                            ("scale_width", "Width"), ("fps", "FPS")):
            if not settings[key].isdigit():
                messagebox.showerror("Invalid value", f"'{label}' must be a number.")
                return

        try:
            audio_delay_ms = int(settings.get("audio_delay_ms") or "0")
        except ValueError:
            messagebox.showerror(
                "Invalid value",
                "'Sync (ms)' must be a whole number of milliseconds "
                "(it may be negative, e.g. -100).",
            )
            return

        ffmpeg = self._find_ffmpeg(settings["ffmpeg_path"])
        if not ffmpeg:
            return

        monitor_label_selected = self.monitor_var.get()
        monitor = self.monitors_by_label.get(monitor_label_selected)
        include_audio = self.include_audio_var.get()
        audio_device = self.audio_device_var.get().strip() if include_audio else ""

        if include_audio and not audio_device:
            messagebox.showerror(
                "No audio device selected",
                "'Include audio' is checked but no audio device is chosen. "
                "Click 'List audio devices' and pick one, or uncheck "
                "'Include audio' to stream video only.",
            )
            return

        encoder_pref = self._current_encoder_pref()
        capture_pref = self._current_capture_pref()
        monitor_index = self.monitor_index_by_label.get(monitor_label_selected, 0)
        save_config({
            **settings,
            "include_audio": include_audio,
            "audio_device": audio_device,
            "encoder_pref": encoder_pref,
            "capture_method": capture_pref,
        })

        self.start_btn.configure(state="disabled")
        self.stop_btn.configure(state="normal")
        self.status_var.set("Detecting encoder...")

        def worker():
            encoder, encoder_args = detect_encoder(ffmpeg, preference=encoder_pref, log_fn=self._log)

            # Resolve how we capture the screen. Desktop Duplication is far
            # faster but isn't available everywhere, so unless the user
            # forced GDI we verify it works before committing to it.
            if capture_pref == "gdigrab":
                capture = "gdigrab"
                self._log("Capture method: GDI (chosen manually).\n")
            else:
                works, detail = test_ddagrab(ffmpeg, monitor_index)
                if works:
                    capture = "ddagrab"
                    self._log("Capture method: Desktop Duplication (GPU).\n")
                elif capture_pref == "ddagrab":
                    capture = "gdigrab"
                    reason = f" ({detail})" if detail else ""
                    self._log(
                        f"Desktop Duplication was selected but isn't usable here{reason}"
                        " -- falling back to GDI capture.\n"
                    )
                else:
                    capture = "gdigrab"
                    reason = f" ({detail})" if detail else ""
                    self._log(f"Capture method: GDI (Desktop Duplication unavailable{reason}).\n")

            if capture == "gdigrab" and int(settings["fps"]) > 30:
                self._log(
                    "Note: GDI capture copies every frame through the CPU and "
                    "often can't sustain more than ~30fps at 1080p. If the "
                    "picture looks choppy, either lower FPS to 30 or get "
                    "Desktop Duplication working.\n"
                )

            local_ip = get_local_ip(settings["tv_ip"])
            self._log(f"This PC's LAN IP: {local_ip}\n")
            self._log(f"Streaming to: {settings['tv_ip']}:{settings['tv_port']}\n")
            self._log(f"Screen: {monitor_label_selected}\n")
            if audio_device:
                self._log(f"Audio device: {audio_device}\n")
                self._log(f"Audio capture chunk: {AUDIO_BUFFER_MS}ms.\n")
                if audio_delay_ms:
                    direction = "later" if audio_delay_ms > 0 else "earlier"
                    self._log(f"Audio shifted {abs(audio_delay_ms)}ms {direction}.\n")

            try:
                ipaddress.ip_address(local_ip)
                bind_ip = local_ip  # a real address -- safe to bind to explicitly
            except ValueError:
                bind_ip = None  # couldn't determine it -- let the OS pick as before

            cmd = build_command(
                ffmpeg, encoder, encoder_args,
                settings["tv_ip"], settings["tv_port"], settings["bitrate_kbps"],
                settings["scale_width"], settings["fps"],
                monitor=monitor, audio_device=(audio_device or None),
                local_ip=bind_ip, capture=capture, monitor_index=monitor_index,
                audio_delay_ms=audio_delay_ms,
            )
            self._log("Running: " + " ".join(cmd) + "\n")
            self.status_var.set(f"Streaming (encoder: {encoder}, capture: {capture})")

            try:
                self.proc = subprocess.Popen(
                    cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, bufsize=1,
                )
            except Exception as exc:
                self._log(f"Failed to start ffmpeg: {exc}\n")
                self.status_var.set("Error")
                self.start_btn.configure(state="normal")
                self.stop_btn.configure(state="disabled")
                return

            for line in self.proc.stdout:
                self._log(line)
            self.proc.wait()
            self._log(f"ffmpeg exited (code {self.proc.returncode}).\n")
            self.status_var.set("Idle")
            self.start_btn.configure(state="normal")
            self.stop_btn.configure(state="disabled")

        self.reader_thread = threading.Thread(target=worker, daemon=True)
        self.reader_thread.start()

    def _stop_clicked(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            self._log("Stopping...\n")
        self.stop_btn.configure(state="disabled")

    def _on_close(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
        self.root.destroy()


def main():
    # Must happen before any monitor enumeration (and before Tk sizes its
    # own window) or captures come out cropped on scaled displays.
    enable_dpi_awareness()
    root = tk.Tk()
    app = StreamerApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
