# The original Python version

This is where LANCAST started: a single-file Tkinter app driving ffmpeg. It
still works — run `start_tv_stream.bat`, or `python tv_stream_gui.py` — and it
needs ffmpeg on PATH, since it has no bundled copy.

It is kept for two reasons.

**It is the reference implementation.** Every tuned value in the Electron app
came from rounds of testing against real hardware here: the 50ms audio capture
chunk, the -112ms sync default, the NVENC preset and rate-control settings, the
Desktop Duplication capture path, the physical-pixel monitor handling. The test
suite (`tests/parity.test.mjs`) loads this file and asserts the new
implementation produces byte-identical ffmpeg arguments across 72
configurations, so this is not dead code — it actively guards against
regressions.

**It is a fallback.** If the Electron app misbehaves on some machine, this one
has no Electron, no Node, and no bundled binaries to go wrong.

The long comments in `tv_stream_gui.py` explain the reasoning behind each
setting and are worth reading before changing anything in the port.
