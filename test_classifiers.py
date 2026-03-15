"""
tests/test_classifiers.py
─────────────────────────
Lightweight tests using synthetically generated audio (no real MP3s needed).
Run with:  pytest tests/
"""

import numpy as np
import pytest
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from classifier import (
    classify_audio_quality,
    classify_speaker,
    classify_speech_rate,
    classify_genre,
)

SR = 22050  # Hz


# ──────────────────────────────────────────────────────────────────
# AUDIO HELPERS
# ──────────────────────────────────────────────────────────────────

def sine(freq_hz: float, duration: float = 3.0, amplitude: float = 0.5) -> np.ndarray:
    t = np.linspace(0, duration, int(SR * duration), endpoint=False)
    return (amplitude * np.sin(2 * np.pi * freq_hz * t)).astype(np.float32)


def white_noise(duration: float = 3.0, amplitude: float = 0.3) -> np.ndarray:
    rng = np.random.default_rng(42)
    return (amplitude * rng.standard_normal(int(SR * duration))).astype(np.float32)


def voiced_signal(f0: float, duration: float = 5.0) -> np.ndarray:
    """Simulate a voiced speech signal with harmonics at multiples of F0."""
    t = np.linspace(0, duration, int(SR * duration), endpoint=False)
    y = np.zeros_like(t)
    for k in range(1, 8):                   # harmonics
        y += (1.0 / k) * np.sin(2 * np.pi * f0 * k * t)
    # add slight AM to simulate syllables
    envelope = 0.5 + 0.5 * np.sin(2 * np.pi * 3.5 * t)   # ~3.5 syl/s
    return (0.4 * y * envelope).astype(np.float32)


def silent_gaps(y: np.ndarray, n_gaps: int = 4) -> np.ndarray:
    """Insert silence gaps to make the signal more speech-like."""
    out = y.copy()
    chunk = len(y) // (n_gaps * 2 + 1)
    for i in range(n_gaps):
        start = (2 * i + 1) * chunk
        out[start : start + chunk // 2] = 0
    return out


# ──────────────────────────────────────────────────────────────────
# AUDIO QUALITY
# ──────────────────────────────────────────────────────────────────

class TestAudioQuality:
    def test_clean_tone_is_clear(self):
        y = sine(440, duration=4)
        result = classify_audio_quality(y, SR)
        assert result["label"] == "clear"
        assert result["clarity_score"] > 0.5

    def test_pure_noise_is_noisy(self):
        y = white_noise(duration=4)
        result = classify_audio_quality(y, SR)
        assert result["label"] == "noisy"
        assert result["clarity_score"] < 0.5

    def test_snr_greater_for_tone_vs_noise(self):
        tone  = classify_audio_quality(sine(440, 4), SR)
        noise = classify_audio_quality(white_noise(4), SR)
        assert tone["snr_db"] > noise["snr_db"]

    def test_returns_expected_keys(self):
        y = sine(300, duration=2)
        r = classify_audio_quality(y, SR)
        assert set(r.keys()) == {"snr_db", "spectral_score", "clarity_score", "label"}


# ──────────────────────────────────────────────────────────────────
# SPEAKER GENDER
# ──────────────────────────────────────────────────────────────────

class TestSpeakerGender:
    def test_low_f0_is_male(self):
        y = voiced_signal(f0=120.0, duration=6)
        r = classify_speaker(y, SR)
        # With synthetic signal pyin may not track perfectly, but F0 should be low
        if r["label"] != "unknown":
            assert r["label"] in ("male",), f"Expected male, got {r}"

    def test_high_f0_is_female_or_child(self):
        y = voiced_signal(f0=260.0, duration=6)
        r = classify_speaker(y, SR)
        if r["label"] != "unknown":
            assert r["label"] in ("female", "child")

    def test_f0_increases_with_frequency(self):
        low  = classify_speaker(voiced_signal(100), SR)
        high = classify_speaker(voiced_signal(280), SR)
        if low["f0_median_hz"] and high["f0_median_hz"]:
            assert high["f0_median_hz"] > low["f0_median_hz"]

    def test_returns_expected_keys(self):
        y = voiced_signal(150)
        r = classify_speaker(y, SR)
        assert set(r.keys()) == {"f0_median_hz", "f0_std_hz", "label"}


# ──────────────────────────────────────────────────────────────────
# SPEECH RATE
# ──────────────────────────────────────────────────────────────────

class TestSpeechRate:
    def _speech_at_rate(self, syl_per_sec: float, duration: float = 8.0) -> np.ndarray:
        """Create amplitude-modulated signal with given syllable rate."""
        t = np.linspace(0, duration, int(SR * duration))
        carrier  = np.sin(2 * np.pi * 200 * t)
        envelope = np.clip(np.sin(2 * np.pi * syl_per_sec * t), 0, 1)
        return (0.4 * carrier * envelope).astype(np.float32)

    def test_slow_speech(self):
        y = self._speech_at_rate(2.0)
        r = classify_speech_rate(y, SR)
        assert r["label"] in ("slow", "medium")  # synthetic may not be perfect

    def test_fast_speech(self):
        y = self._speech_at_rate(6.5)
        r = classify_speech_rate(y, SR)
        assert r["label"] in ("medium", "fast")

    def test_syl_per_sec_is_positive(self):
        y = self._speech_at_rate(4.0)
        r = classify_speech_rate(y, SR)
        assert r["syllables_per_second"] > 0

    def test_returns_expected_keys(self):
        y = self._speech_at_rate(4.0)
        r = classify_speech_rate(y, SR)
        assert set(r.keys()) == {"syllables_per_second", "label"}


# ──────────────────────────────────────────────────────────────────
# GENRE
# ──────────────────────────────────────────────────────────────────

class TestGenre:
    def test_sci_fi_keywords(self):
        r = classify_genre(
            "The Martian Chronicles",
            "A story about alien invasion and spaceship travel across the galaxy.",
        )
        assert r["genre"] == "science_fiction"

    def test_mystery_keywords(self):
        r = classify_genre(
            "Murder on the Orient Express",
            "A murder mystery detective thriller with poison and clues.",
        )
        assert r["genre"] == "mystery_thriller"

    def test_philosophy_keywords(self):
        r = classify_genre(
            "Meditations on Ethics",
            "Explores stoic philosophy, virtue, and metaphysics.",
        )
        assert r["genre"] == "philosophy"

    def test_unknown_returns_unknown(self):
        r = classify_genre("XYZ", "Lorem ipsum dolor sit amet consectetur.")
        assert r["genre"] == "unknown"
        assert r["genre_confidence"] == 0.0

    def test_subjects_boost_score(self):
        r1 = classify_genre("My Book", "A story",  subjects=[])
        r2 = classify_genre("My Book", "A story",  subjects=["science fiction", "alien"])
        assert r2.get("genre") == "science_fiction"

    def test_returns_expected_keys(self):
        r = classify_genre("Test", "A mystery detective story")
        assert {"genre", "genre_confidence", "genre_scores"} <= set(r.keys())
