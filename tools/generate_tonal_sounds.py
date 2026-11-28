"""Compose the original tonal layer and mix native fallback tracks from the foley bank."""
import json
import math
from array import array
from pathlib import Path
import subprocess
import tempfile
import wave

RATE = 24000
OUT = Path(__file__).resolve().parents[1] / 'apps/web/src/audio'
TAU = 2 * math.pi


def tone(seconds, notes, level=.22):
    """Soft, slightly inharmonic resonances with slow attack and long decay."""
    samples = []
    for i in range(round(seconds * RATE)):
        t = i / RATE
        value = 0.0
        for frequency, start, weight in notes:
            elapsed = t - start
            if elapsed < 0:
                continue
            envelope = min(1, elapsed / .12) * math.exp(-elapsed / 1.25)
            value += weight * envelope * (math.sin(TAU * frequency * elapsed) + .20 * math.sin(TAU * frequency * 2.01 * elapsed))
        fade = min(1, max(0, (seconds - t) / .12))
        samples.append(max(-1, min(1, value * level * fade)))
    return samples


def bed(seconds):
    # Frequencies are integer multiples of the loop fundamental for a seamless loop.
    fundamental = 1 / seconds
    return [(.050 * math.sin(TAU * round(110 / fundamental) * fundamental * i / RATE) +
             .027 * math.sin(TAU * round(165 / fundamental) * fundamental * i / RATE) +
             .015 * math.sin(TAU * round(220 / fundamental) * fundamental * i / RATE)) *
            (.70 + .30 * math.cos(TAU * i / (seconds * RATE))) for i in range(round(seconds * RATE))]


def wav(path, samples):
    pcm = array('h', (round(max(-1, min(1, value)) * 32767) for value in samples))
    with wave.open(str(path), 'wb') as output:
        output.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        output.writeframes(pcm.tobytes())


def build():
    offsets = json.loads((OUT / 'mine.json').read_text(encoding='utf-8'))
    pieces = {
        'start': tone(2.8, [(110, 0, .55), (164.81, .20, .36), (220, .47, .30)]),
        'reveal': tone(2.5, [(146.83, 0, .48), (220, .24, .35), (293.66, .52, .24)]),
        'gold': tone(3.3, [(146.83, 0, .44), (220, .18, .38), (293.66, .38, .32), (369.99, .62, .23)]),
        'round': tone(2.8, [(164.81, 0, .38), (130.81, .22, .42), (110, .49, .46)]),
        'turn': tone(1.35, [(329.63, 0, .40), (440, .20, .30)], .18),
    }
    with tempfile.TemporaryDirectory() as temp:
        temp = Path(temp)
        combined = []
        positions = {}
        for name, samples in pieces.items():
            positions[name] = [round(len(combined) / RATE, 6), len(samples) / RATE]
            combined.extend(samples)
        wav(temp / 'tones.wav', combined)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(temp / 'tones.wav'), '-c:a', 'libmp3lame', '-q:a', '3', str(OUT / 'mine-tones.mp3')], check=True)
        (OUT / 'mine-tones.json').write_text(json.dumps(positions, separators=(',', ':')) + '\n', encoding='utf-8')
        for name, source, duration, tonal in [
            ('ambience', offsets['mineBed'][0][0], offsets['mineBed'][0][1], bed(offsets['mineBed'][0][1])),
            ('start', offsets['start'][0][0], offsets['start'][0][1], pieces['start']),
            ('turn', offsets['minePick'][0][0] + .168, .32, pieces['turn']),
        ]:
            wav(temp / 'tone.wav', tonal)
            foley = ('alimiter=limit=0.35:level=false' if name == 'ambience' else
                     'volume=0.8' if name == 'start' else 'adelay=160,aecho=1:1:300:1,volume=0.42')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(source), '-t', str(duration), '-i', str(OUT / 'mine.mp3'),
                            '-i', str(temp / 'tone.wav'), '-filter_complex', f'[0:a]{foley}[f];[f][1:a]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.9:level=false',
                            '-map_metadata', '-1', '-c:a', 'libmp3lame', '-q:a', '5', str(OUT / f'mine-{name}.mp3')], check=True)


if __name__ == '__main__':
    build()
