"""Cut and mix the CC0 recordings listed in docs/SOUND_SOURCES.md."""

import argparse
from array import array
import json
from pathlib import Path
import subprocess
import tempfile
import wave


RATE = 24000
OUTPUT = Path(__file__).resolve().parents[1] / "apps/web/src/audio"
ECHO = "aecho=0.85:0.9:115|230:0.23|0.13"


def count(seconds):
    return round(seconds * RATE)


def cut(folder, name, start, duration, filters="", fade_in=.008, fade_out=.065):
    path = folder / (name + ".mp3")
    filters = [f"atrim=duration={duration}", "asetpts=PTS-STARTPTS"] + filters.split(",")
    result = subprocess.check_output([
        "ffmpeg", "-v", "error", "-ss", str(start), "-i", str(path),
        "-af", ",".join(filter(None, filters)), "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-",
    ])
    sound = array("f")
    sound.frombytes(result)
    for index in range(min(count(fade_in), len(sound))):
        sound[index] *= index / count(fade_in)
    for index in range(min(count(fade_out), len(sound))):
        sound[-1 - index] *= index / count(fade_out)
    return sound


def layer(*tracks):
    samples = [0.0] * max(count(offset) + len(sound) for offset, sound, _ in tracks)
    for offset, sound, gain in tracks:
        for index, value in enumerate(sound, count(offset)):
            samples[index] += gain * value
    return samples


def loop_room_tone(sound, crossfade):
    overlap = count(crossfade)
    loop = sound[overlap:-overlap]
    loop.extend(sound[-overlap + index] * (1 - index / overlap) + sound[index] * index / overlap
                for index in range(overlap))
    return loop


def clips(folder):
    def take(name, start, duration, filters="", fade_in=.008, fade_out=.065):
        return cut(folder, name, start, duration, filters, fade_in, fade_out)

    stone = take("stone", .06, .72, "highpass=f=55,lowpass=f=5300")
    thud = take("hit", 0, .28, "highpass=f=65,lowpass=f=3000")
    latch = take("metal", .006, .43, "highpass=f=110,lowpass=f=6500")
    coins = take("coins", .027, .32, "highpass=f=200,lowpass=f=6400," + ECHO)
    bed = take("cave", .85, 20.5, "highpass=f=100,lowpass=f=3400", 0, 0)
    far_pick = "highpass=f=145,lowpass=f=3000," + ECHO
    far_voice = "highpass=f=190,lowpass=f=2450,aecho=0.85:0.9:145|290:0.29|0.16"

    return {
        "tunnel": ([
            layer((0, stone, .72), (.27, thud, .61)),
            layer((0, take("stone", .23, .59, "highpass=f=75,lowpass=f=4100"), .85), (.20, thud, .5)),
            layer((0, thud, .58), (.05, take("stone", .45, .56, "highpass=f=65,lowpass=f=4300"), .9)),
        ], .67),
        "discard": ([take("cards", time, .37, "highpass=f=160") for time in [18.14, 19.19, 23.54]], .44),
        "break": ([take("metal", time, .94, "highpass=f=60,lowpass=f=6900", fade_out=.15) for time in [0, 2.39, 7.85]], .76),
        "repair": ([
            layer((0, take("wrench", time, .72, "highpass=f=165,lowpass=f=7600"), 7.0), (.54, latch, .3))
            for time in [16.15, 17.45, 22.55]
        ], .66),
        "scout": ([
            layer((0, take("cards", 13.38, .52, "highpass=f=140,lowpass=f=5000"), 1), (.15, thud, .045)),
            take("cards", 14.61, .55, "highpass=f=135,lowpass=f=4600"),
        ], .42),
        "collapse": ([
            take("rock", 0, 2.11, "highpass=f=40,lowpass=f=6000," + ECHO, fade_out=.26),
            take("rock", .80, 2.48, "highpass=f=45,lowpass=f=5200," + ECHO, fade_out=.29),
        ], .77),
        "reveal": ([take("stone", 0, 1.1, "highpass=f=80,lowpass=f=4200," + ECHO)], .56),
        "gold": ([layer((0, take("stone", .35, .53, "lowpass=f=2900"), .124), (.20, coins, 2.3), (.47, coins, 1.48))], .72),
        "round": ([take("cards", 29.7, 1.24, "highpass=f=115,lowpass=f=4500", fade_out=.21)], .52),
        "start": ([take("cards", 2.68, 1.02, "highpass=f=110,lowpass=f=7100", fade_out=.13)], .58),
        "mineBed": ([loop_room_tone(bed, 1.8)], .48),
        "minePick": ([take("pick", time, 2.07, far_pick, .15, .21) for time in [.27, 2.97, 4.28]], .63),
        "mineCart": ([take("cart", time, 5.35, "highpass=f=90,lowpass=f=2650," + ECHO, .91, 1.23)
                      for time in [.42, 7.48]], .64),
        "mineVoices": ([
            take("voice", 1.29, 1.18, far_voice, .05, .22),
            take("voice", 7.63, 1.22, far_voice, .05, .23),
            take("crew", 0, .64, far_voice, .013, .15),
        ], .54),
    }


def write_media_tracks(offsets):
    bed_offset, bed_duration = offsets["mineBed"][0]
    start_offset, start_duration = offsets["start"][0]
    strike_offset = offsets["minePick"][0][0] + .168
    tracks = [
        ("ambience", bed_offset, bed_duration, "alimiter=limit=0.35:level=false"),
        ("start", start_offset, start_duration, "volume=0.8"),
        ("turn", strike_offset, .32, "adelay=160,aecho=1:1:300:1,volume=0.42"),
    ]
    for name, offset, duration, filters in tracks:
        subprocess.run([
            "ffmpeg", "-v", "error", "-y", "-ss", str(offset), "-t", str(duration),
            "-i", str(OUTPUT / "mine.mp3"), "-af", filters, "-map_metadata", "-1",
            "-c:a", "libmp3lame", "-q:a", "5", str(OUTPUT / f"mine-{name}.mp3"),
        ], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recordings", type=Path, help="Folder with original clips named as in docs/SOUND_SOURCES.md")
    args = parser.parse_args()

    pcm = array("h")
    offsets = {}
    for name, (variants, peak) in clips(args.recordings).items():
        offsets[name] = []
        for sound in variants:
            loop = name == "mineBed"
            clip_start = len(pcm)
            pcm.extend([0] * count(.044))
            samples_start = len(pcm)
            normalize = 32767 * peak / max(map(abs, sound))
            pcm.extend(round(value * normalize) for value in sound)
            pcm.extend([0] * count(.092))
            start = samples_start if loop else clip_start
            duration = len(sound) if loop else len(pcm) - clip_start
            offsets[name].append([round(start / RATE, 6), round(duration / RATE, 6)])

    OUTPUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        uncompressed = Path(temporary) / "mine.wav"
        with wave.open(str(uncompressed), "wb") as target:
            target.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
            target.writeframes(pcm.tobytes())
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(uncompressed),
                        "-c:a", "libmp3lame", "-q:a", "5", str(OUTPUT / "mine.mp3")], check=True)
    (OUTPUT / "mine.json").write_text(json.dumps(offsets, separators=(",", ":")) + "\n", encoding="utf-8")
    write_media_tracks(offsets)
    from generate_tonal_sounds import build as build_tonal_sounds
    build_tonal_sounds()


if __name__ == "__main__":
    main()
