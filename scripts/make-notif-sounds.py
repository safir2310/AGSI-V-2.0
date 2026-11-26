#!/usr/bin/env python3
"""Generate WAV notifikasi AGSI (res/raw) — ding, bell, marimba, pop.

Suara pendek & lembut (mono 16-bit 44,1 kHz), amplitudo dinormalisasi,
dengan ramp attack/release 5 ms anti-klik. agsi_chime.wav sudah ada di repo.
Output: download/agsi-android/app/src/main/res/raw/agsi_<nama>.wav
"""
import math
import struct
import wave
import os

SR = 44100

def synth(samples, path, gain=0.72):
    peak = max(abs(s) for s in samples) or 1.0
    n = len(samples)
    ramp = int(0.005 * SR)  # 5 ms attack & release
    out = []
    for i, s in enumerate(samples):
        v = (s / peak) * gain
        if i < ramp:
            v *= i / ramp
        if n - i <= ramp:
            v *= (n - i) / ramp
        out.append(v)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b"".join(
            struct.pack("<h", int(max(-1.0, min(1.0, v)) * 32767)) for v in out
        ))
    print(f"OK {path}  ({n/SR:.2f}s)")

def env_exp(t, dur, decay):
    return math.exp(-t / decay) * (1.0 if t < dur else 0.0)

def tone(freq, dur, decay, partials, vib_hz=0.0, vib_amt=0.0):
    n = int(dur * SR)
    out = []
    for i in range(n):
        t = i / SR
        f = freq * (1.0 + vib_amt * math.sin(2 * math.pi * vib_hz * t))
        s = 0.0
        for amp, mult in partials:
            s += amp * math.sin(2 * math.pi * f * mult * t) * env_exp(t, dur, decay / mult)
        out.append(s)
    return out

def mix(*layers):
    n = max(off + len(x) for x, off in layers)
    out = [0.0] * n
    for layer, offset in layers:
        for i, s in enumerate(layer):
            j = i + offset
            if j < n:
                out[j] += s
    return out

BASE = "/home/z/my-project/download/agsi-android/app/src/main/res/raw"

# ding — dering tunggal cerah (E6), jatuh cepat
ding = tone(1318.5, 0.45, 0.10, [(1.0, 1.0), (0.35, 2.0), (0.12, 3.0)])
synth(ding, f"{BASE}/agsi_ding.wav")

# bell — bel ganda (A5 + oktaf), dengung panjang lembut
bell = mix(
    (tone(880.0, 1.1, 0.30, [(1.0, 1.0), (0.4, 2.0), (0.15, 4.0)]), 0),
    (tone(1760.0, 1.1, 0.35, [(0.5, 1.0), (0.2, 2.0)]), 0),
)
synth(bell, f"{BASE}/agsi_bell.wav")

# marimba — kayu hangat (G5), aksen cepat, resonansi pendek
mar = tone(784.0, 0.55, 0.085, [(1.0, 1.0), (0.5, 4.0), (0.22, 9.6)])
synth(mar, f"{BASE}/agsi_marimba.wav")

# pop — gelembung ramah naik (C6→E6), sangat singkat
n = int(0.14 * SR)
pop = []
for i in range(n):
    t = i / SR
    f = 1046.5 + (1318.5 - 1046.5) * (t / 0.14)
    pop.append(math.sin(2 * math.pi * f * t) * math.exp(-t / 0.045))
synth(pop, f"{BASE}/agsi_pop.wav")
