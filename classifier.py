"""
classifier.py
─────────────
Audio + metadata classifiers for audiobook indexing.

1. audio_quality   → clarity score 0-1, label "clear" / "noisy"
2. speaker_gender  → uses librosa.yin (fast pitch) on voiced frames
3. speech_rate     → syllable nuclei count / voiced seconds
4. genre           → keyword match on title + description + inferred from title patterns
"""

from __future__ import annotations
import numpy as np
import librosa
from scipy.signal import find_peaks


# ──────────────────────────────────────────────
# 1. AUDIO QUALITY
# ──────────────────────────────────────────────

def classify_audio_quality(y: np.ndarray, sr: int) -> dict:
    frame_length = int(0.025 * sr)
    hop_length   = int(0.010 * sr)

    rms = librosa.feature.rms(y=y, frame_length=frame_length,
                               hop_length=hop_length)[0]
    if rms.max() == 0:
        return {"snr_db": 0.0, "spectral_score": 0.0,
                "clarity_score": 0.0, "label": "noisy"}

    threshold     = rms.max() * 0.05
    signal_frames = rms[rms >= threshold]
    noise_frames  = rms[rms <  threshold]

    if len(noise_frames) == 0 or noise_frames.mean() == 0:
        snr_db = 60.0
    else:
        snr_db = float(np.clip(
            20 * np.log10(signal_frames.mean() / (noise_frames.mean() + 1e-9)),
            0, 60))

    sf             = librosa.feature.spectral_flatness(y=y, hop_length=hop_length)[0]
    spectral_score = float(np.clip(1.0 - float(np.median(sf)), 0.0, 1.0))
    clarity_score  = float(np.clip(
        0.6 * (snr_db / 40.0) + 0.4 * spectral_score, 0.0, 1.0))

    return {
        "snr_db":         round(snr_db, 2),
        "spectral_score": round(spectral_score, 3),
        "clarity_score":  round(clarity_score, 3),
        "label":          "clear" if clarity_score >= 0.5 else "noisy",
    }


# ──────────────────────────────────────────────
# 2. SPEAKER GENDER  — librosa.yin (fast, accurate)
# ──────────────────────────────────────────────
#
# yin is ~10x faster than pyin and tracks F0 reliably on speech.
# Male speech fundamental: 85-180 Hz
# Female speech fundamental: 165-300 Hz
# Child speech fundamental: 250-400 Hz
# AI/TTS voices tend to cluster in 150-220 Hz range

def classify_speaker(y: np.ndarray, sr: int) -> dict:
    hop_length   = 256
    frame_length = 2048

    try:
        f0 = librosa.yin(
            y,
            fmin=librosa.note_to_hz("C2"),   # 65 Hz floor
            fmax=librosa.note_to_hz("C5"),   # 523 Hz ceiling
            sr=sr,
            hop_length=hop_length,
            frame_length=frame_length,
        )
    except Exception:
        return {"f0_median_hz": None, "f0_std_hz": None, "label": "fiction"}

    # yin returns fmax for unvoiced frames — filter those out
    fmax  = float(librosa.note_to_hz("C5"))
    valid = f0[(f0 > 70) & (f0 < fmax * 0.98)]

    if len(valid) < 5:
        return {"f0_median_hz": None, "f0_std_hz": None, "label": "fiction"}

    median_hz = float(np.median(valid))
    std_hz    = float(np.std(valid))

    # Thresholds based on acoustic phonetics literature
    # (adjusted for TTS/AI voices which sit slightly higher than natural)
    if median_hz < 165:
        label = "male"
    elif median_hz < 255:
        label = "female"
    else:
        label = "child"

    return {
        "f0_median_hz": round(median_hz, 1),
        "f0_std_hz":    round(std_hz, 1),
        "label":        label,
    }


# ──────────────────────────────────────────────
# 3. SPEECH RATE
# ──────────────────────────────────────────────

def classify_speech_rate(y: np.ndarray, sr: int) -> dict:
    hop_length = int(0.010 * sr)
    rms        = librosa.feature.rms(y=y, frame_length=512,
                                      hop_length=hop_length)[0]
    rms_smooth = np.convolve(rms, np.hanning(9) / np.hanning(9).sum(),
                             mode="same")

    if rms_smooth.max() == 0:
        return {"syllables_per_second": 0.0, "label": "slow"}

    threshold = rms_smooth.max() * 0.30
    peaks, _  = find_peaks(rms_smooth, height=threshold,
                            distance=int(0.08 / 0.010))

    intervals  = librosa.effects.split(y, top_db=30)
    voiced_dur = sum(e - s for s, e in intervals) / sr if len(intervals) else \
                 len(y) / sr

    syl_per_sec = len(peaks) / max(voiced_dur, 0.001)

    if syl_per_sec < 3.0:
        label = "slow"
    elif syl_per_sec <= 5.0:
        label = "medium"
    else:
        label = "fast"

    return {
        "syllables_per_second": round(syl_per_sec, 2),
        "label":                label,
    }


# ──────────────────────────────────────────────
# 4. GENRE — keyword matching + title pattern inference
# ──────────────────────────────────────────────

_GENRE_KEYWORDS: dict[str, list[str]] = {
    "science_fiction": [
        "science fiction", "sci-fi", "sci fi", "alien", "spaceship", "robot",
        "dystopia", "utopia", "time travel", "martian", "interstellar", "galaxy",
        "post-apocalyptic", "apocalypse", "apocalyptic", "zombie", "undead",
        "cyberpunk", "space opera", "dune", "hunger games", "divergent",
        "maze runner", "ender", "asimov", "philip k dick", "frank herbert",
    ],
    "mystery_thriller": [
        "mystery", "detective", "murder", "crime", "thriller", "suspense",
        "sherlock", "whodunit", "poison", "investigation", "homicide",
        "serial killer", "cold case", "forensic", "psychological thriller",
        "jack reacher", "james patterson", "lee child", "baldacci", "spy",
        "espionage", "heist", "blackout", "survival thriller",
    ],
    "adventure": [
        "adventure", "journey", "voyage", "expedition", "quest", "treasure",
        "pirate", "explorer", "survival", "wilderness", "action",
    ],
    "horror": [
        "horror", "ghost", "haunted", "vampire", "monster", "lovecraft",
        "cthulhu", "terror", "dread", "supernatural", "demon", "witch",
        "dracula", "frankenstein", "zombie", "undead", "creepy", "dark",
    ],
    "romance": [
        "romance", "love story", "love", "courtship", "marriage", "passion",
        "better than the movies", "romantic", "chick lit", "women's fiction",
        "lost girls", "heart",
    ],
    "historical_fiction": [
        "historical", "ancient", "medieval", "victorian", "war", "revolution",
        "empire", "knight", "world war", "civil war",
    ],
    "informational_science": [
        "science", "evolution", "biology", "physics", "chemistry", "astronomy",
        "mathematics", "natural history", "darwin", "non-fiction", "nonfiction",
        "true story", "true crime",
    ],
    "philosophy": [
        "philosophy", "ethics", "metaphysics", "logic", "soul", "virtue",
        "stoic", "meditations",
    ],
    "biography": [
        "biography", "autobiography", "memoir", "life of", "letters of",
    ],
    "classic_literature": [
        "classic", "orwell", "dickens", "austen", "twain", "wilde", "tolkien",
        "tolkien", "children of hurin", "animal farm", "peter pan", "wind in the willows",
        "secret garden", "great gatsby", "jane eyre", "moby dick", "sherlock",
        "jules verne", "hg wells", "unabridged",
    ],
}

# Title-level pattern overrides — catches common YouTube title formats
_TITLE_PATTERNS: list[tuple[str, str]] = [
    ("thriller",         "mystery_thriller"),
    ("crime",            "mystery_thriller"),
    ("mystery",          "mystery_thriller"),
    ("horror",           "horror"),
    ("zombie",           "science_fiction"),
    ("apocalypse",       "science_fiction"),
    ("apocalyptic",      "science_fiction"),
    ("romance",          "romance"),
    ("love",             "romance"),
    ("sci-fi",           "science_fiction"),
    ("science fiction",  "science_fiction"),
    ("fantasy",          "adventure"),
    ("adventure",        "adventure"),
    ("memoir",           "biography"),
    ("biography",        "biography"),
    ("history",          "historical_fiction"),
    ("historical",       "historical_fiction"),
]


def classify_genre(title: str, description: str,
                   subjects: list[str] | None = None) -> dict:
    title_lower = title.lower()
    text        = " ".join(filter(None, [
        title_lower,
        description.lower(),
        " ".join(subjects or []).lower(),
    ]))

    # Keyword scoring
    scores = {g: sum(1 for kw in kws if kw in text)
              for g, kws in _GENRE_KEYWORDS.items()}
    scores = {g: v for g, v in scores.items() if v}

    # Title pattern boost (adds weight when title explicitly says the genre)
    for pattern, genre in _TITLE_PATTERNS:
        if pattern in title_lower:
            scores[genre] = scores.get(genre, 0) + 2

    scores = {g: v for g, v in scores.items() if v}
    if not scores:
        return {"genre": "fiction", "genre_confidence": 0.0, "genre_scores": {}}

    best       = max(scores, key=scores.__getitem__)
    confidence = round(scores[best] / sum(scores.values()), 3)

    return {
        "genre":            best,
        "genre_confidence": confidence,
        "genre_scores":     scores,
    }


# ──────────────────────────────────────────────
# COMBINED — load audio once, run all classifiers
# ──────────────────────────────────────────────

def analyse_audio_file(
    audio_path:      str,
    title:           str             = "",
    description:     str             = "",
    subjects:        list[str] | None = None,
    *,
    sample_duration: float           = 20.0,
) -> dict:
    # Load at 16 kHz — sufficient for all classifiers, 3x faster than 44 kHz
    y, sr = librosa.load(audio_path, sr=16_000, mono=True,
                         duration=sample_duration)
    return {
        "quality":     classify_audio_quality(y, sr),
        "speaker":     classify_speaker(y, sr),
        "speech_rate": classify_speech_rate(y, sr),
        "genre":       classify_genre(title, description, subjects),
    }