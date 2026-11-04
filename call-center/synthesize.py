"""Milestone 1 proof of concept: Kinyarwanda TTS with facebook/mms-tts-kin.

Usage:
    .venv/bin/python synthesize.py                       # generate default samples/
    .venv/bin/python synthesize.py "Muraho neza" out.wav # synthesize one phrase
"""

import sys
import time
from pathlib import Path

import torch
import scipy.io.wavfile
from transformers import VitsModel, AutoTokenizer

MODEL_ID = "facebook/mms-tts-kin"

DEFAULT_SAMPLES = {
    "01-greeting.wav": "Muraho, amakuru yawe?",
    "02-dispatch.wav": (
        "Muraho. Iyi ni telefoni iva kuri Fleebee. "
        "Urasabwa kujya gufata ibicuruzwa kuri Kimironko "
        "saa kumi n'ebyiri za mugitondo. Murakoze."
    ),
    "03-yes-no-question.wav": "Wagejeje ibicuruzwa? Vuga yego cyangwa oya.",
}




def load_model():
    print(f"Loading {MODEL_ID} ...")
    t0 = time.time()
    model = VitsModel.from_pretrained(MODEL_ID)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    print(f"Loaded in {time.time() - t0:.1f}s "
          f"(sampling rate {model.config.sampling_rate} Hz)")
    return model, tokenizer


def synthesize(model, tokenizer, text, out_path):
    inputs = tokenizer(text, return_tensors="pt")
    t0 = time.time()
    with torch.no_grad():
        waveform = model(**inputs).waveform
    audio = waveform.squeeze().numpy()
    scipy.io.wavfile.write(out_path, rate=model.config.sampling_rate, data=audio)
    duration = len(audio) / model.config.sampling_rate
    print(f"{out_path}: {duration:.1f}s of audio, "
          f"synthesized in {time.time() - t0:.1f}s — \"{text}\"")


def main():
    model, tokenizer = load_model()
    if len(sys.argv) == 3:
        synthesize(model, tokenizer, sys.argv[1], sys.argv[2])
    else:
        out_dir = Path(__file__).parent / "samples"
        out_dir.mkdir(exist_ok=True)
        for filename, text in DEFAULT_SAMPLES.items():
            synthesize(model, tokenizer, text, str(out_dir / filename))


if __name__ == "__main__":
    main()
