"""Build the original mine sound effects and their playback offsets."""

from array import array
import json
import math
from pathlib import Path
import random
import subprocess
import tempfile
import wave


RATE = 24000
RNG = random.Random(1729)
OUTPUT = Path(__file__).resolve().parents[1] / "apps/web/src/audio"


def samples(seconds):
    return round(seconds * RATE)


def envelope(t, length, attack, tail):
    return min(1, t / attack, (length - t) / tail)


def texture(length, low, high, decay, level, attack=.004):
    """Band-limited dust, scraping, air or bass rumble."""
    low_step = 1 - math.exp(-math.tau * low / RATE)
    high_step = 1 - math.exp(-math.tau * high / RATE)
    bottom = top = 0
    sound = []
    for i in range(samples(length)):
        noise = RNG.uniform(-1, 1)
        bottom += low_step * (noise - bottom)
        top += high_step * (noise - top)
        t = i / RATE
        sound.append(level * (top - bottom) * math.exp(-t / decay)
                     * envelope(t, length, attack, .03))
    return sound


def impact(length, modes, pitch=1.0):
    """Mix the short resonances of a struck piece of stone, wood or metal."""
    return [
        envelope(i / RATE, length, .002, .035) * sum(
            amplitude * math.sin(math.tau * frequency * pitch * i / RATE)
            * math.exp(-i / (RATE * decay))
            for frequency, amplitude, decay in modes
        )
        for i in range(samples(length))
    ]


def mix(length, *layers):
    track = [0.0] * samples(length)
    for offset, sound in layers:
        start = samples(offset)
        for i, sample in enumerate(sound[:len(track) - start], start):
            track[i] += sample
    return track


STONE = [(128, .48, .034), (246, .17, .026), (384, .09, .018)]
WOOD = [(174, .31, .027), (312, .11, .020), (519, .08, .013)]
METAL = [(421, .25, .058), (812, .12, .040), (1427, .07, .027), (2179, .03, .018)]


def tunnel(pitch):
    return mix(.28,
               (0, texture(.065, 220, 3000, .023, .52)),
               (.026, impact(.14, STONE, pitch)),
               (.028, texture(.24, 480, 3700, .074, .39)),
               (.096, impact(.12, STONE, .68 * pitch)))


def discard(pitch):
    return mix(.25,
               (0, texture(.18, 410, 3900, .077, .52, attack=.021)),
               (.055, texture(.12, 1200, 4800, .038, .18)),
               (.106, impact(.12, WOOD, pitch)))


def break_tool(pitch):
    return mix(.31,
               (0, texture(.07, 550, 4400, .027, .57)),
               (.009, impact(.15, METAL, pitch)),
               (.032, impact(.11, WOOD, .78 * pitch)),
               (.081, texture(.14, 300, 2500, .058, .32)),
               (.126, impact(.15, METAL, .61 * pitch)))


def repair(pitch):
    return mix(.37,
               (0, texture(.10, 420, 3500, .038, .36)),
               (.018, impact(.10, WOOD, pitch)),
               (.065, impact(.16, METAL, .84 * pitch)),
               (.113, impact(.22, METAL, 1.23 * pitch)))


def scout(pitch):
    return mix(.36,
               (0, texture(.28, 340, 2900, .14, .31, attack=.05)),
               (.053, impact(.21, WOOD, .76 * pitch)),
               (.101, impact(.23, METAL, .98 * pitch)))


def collapse():
    layers = [(0, texture(.70, 30, 200, .22, .94, attack=.021)),
              (0, texture(.54, 160, 3500, .19, .48))]
    for offset in [.01, .043, .092, .151, .206, .268, .333, .417]:
        layers.append((offset, impact(.14, STONE, RNG.uniform(.56, 1.24))))
    layers.append((.28, texture(.43, 480, 3600, .13, .34)))
    return mix(.73, *layers)


def gold():
    bell = [(1, .42, .17), (2.01, .13, .095), (2.76, .09, .065), (4.17, .04, .041)]
    return mix(.74,
               (0, impact(.2, STONE, .73)),
               (.06, impact(.41, bell, 392)),
               (.133, impact(.43, bell, 493.88)),
               (.207, impact(.48, bell, 587.33)),
               (.293, texture(.38, 1800, 4400, .11, .105)))


def main():
    sounds = {
        "tunnel": ([tunnel(pitch) for pitch in [.86, .98, 1.13, 1.26]], .58),
        "discard": ([discard(pitch) for pitch in [.82, .99, 1.15, 1.31]], .45),
        "break": ([break_tool(pitch) for pitch in [.88, 1.12]], .57),
        "repair": ([repair(pitch) for pitch in [.91, 1.09]], .54),
        "scout": ([scout(pitch) for pitch in [.9, 1.1]], .45),
        "collapse": ([collapse()], .70),
        "gold": ([gold()], .66),
        "reveal": ([mix(.42, (0, impact(.25, STONE, .59)),
                        (.04, texture(.37, 160, 2700, .16, .53, attack=.028)))], .51),
        "round": ([mix(.50, (0, impact(.20, WOOD, 1.15)),
                       (.081, impact(.32, METAL, .78)),
                       (.13, texture(.33, 360, 3100, .11, .47)))], .52),
        "start": ([mix(.42, (0, impact(.13, WOOD, .87)),
                       (.035, impact(.25, METAL, 1.08)),
                       (.102, impact(.28, METAL, 1.26)))], .50),
    }

    pcm = array("h")
    offsets = {}
    for name, (variants, peak) in sounds.items():
        offsets[name] = []
        for sound in variants:
            start = len(pcm)
            pcm.extend([0] * samples(.05))
            scale = 32767 * peak / max(map(abs, sound))
            pcm.extend(round(value * scale) for value in sound)
            pcm.extend([0] * samples(.08))
            offsets[name].append([round(start / RATE, 3), round((len(pcm) - start) / RATE, 3)])

    OUTPUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        uncompressed = Path(temporary) / "mine.wav"
        with wave.open(str(uncompressed), "wb") as target:
            target.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
            target.writeframes(pcm.tobytes())
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                        "-i", str(uncompressed), "-c:a", "libmp3lame", "-q:a", "5",
                        str(OUTPUT / "mine.mp3")], check=True)
    (OUTPUT / "mine.json").write_text(json.dumps(offsets, separators=(",", ":")) + "\n",
                                     encoding="utf-8")


if __name__ == "__main__":
    main()
