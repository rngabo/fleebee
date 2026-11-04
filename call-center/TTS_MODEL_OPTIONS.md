# Kinyarwanda TTS Model Options

Evaluated `2026-07-23`. Three realistic options for local Kinyarwanda
text-to-speech, ordered by ease of setup. Decision: **test option 1 first**;
only move to option 3 if quality is not good enough.

## Option 1 — facebook/mms-tts-kin (start here)

The Kinyarwanda checkpoint from Meta's Massively Multilingual Speech (MMS)
project. A VITS model that runs directly in the Hugging Face Transformers
library (v4.33+).

- Size: ~150 MB
- Runs fine on CPU — should synthesize in seconds on this laptop
- No special setup: `pip install transformers torch scipy`
- Works with the system Python 3.13

Minimal test script:

```python
from transformers import VitsModel, AutoTokenizer
import torch, scipy.io.wavfile

model = VitsModel.from_pretrained("facebook/mms-tts-kin")
tokenizer = AutoTokenizer.from_pretrained("facebook/mms-tts-kin")

inputs = tokenizer("Muraho, amakuru yawe?", return_tensors="pt")
with torch.no_grad():
    output = model(**inputs).waveform

scipy.io.wavfile.write("out.wav", rate=model.config.sampling_rate,
                       data=output.squeeze().numpy())
```

## Option 2 — DigitalUmuganda/Kinyarwanda_YourTTS

A YourTTS model trained on 67 hours of Kinyarwanda bible audio via Coqui TTS.
Supports zero-shot voice cloning from ~1 minute of speech.

- Better if we want to clone a specific voice (e.g. a known announcer voice)
- Requires a pinned version of the now-abandoned Coqui TTS library
- Fiddly on newer Python — needs a 3.10/3.11 venv or pyenv (this machine has
  Python 3.13.7, so a separate environment is mandatory)

Treat as a fallback only if voice cloning becomes a requirement.

## Option 3 — KinyaTTS

A PyTorch codebase based on MB-iSTFT-VITS2, with a downloadable pre-trained
model and an inference notebook (GitHub repo, manual clone-and-run — not a
one-liner).

- Probably the best quality for Kinyarwanda tones
- More setup effort than option 1

Use this if MMS-TTS output is not intelligible or natural enough.

## Known Quality Caveat

The local models are trained mostly on bible audio, and tonal accuracy in
Kinyarwanda is a known weakness. Expect intelligible but somewhat flat
prosody. A Kinyarwanda speaker should judge whether it is acceptable for
biker calls before any integration work.

Tip: the mbazaNLP demo Space on Hugging Face can be tried in the browser
first to hear what this family of models sounds like before installing
anything.

## Test Plan

1. Set up a venv in `call-center/` and install `transformers torch scipy`.
2. Run the option 1 script; produce `out.wav` from a realistic biker call
   phrase (not just "Muraho") — e.g. a dispatch or reminder sentence actually
   used with bikers.
3. Have a Kinyarwanda speaker rate: intelligibility, naturalness, and whether
   tone errors change meaning.
4. Record findings (sample phrases + verdicts) in this file or the progress
   log.
5. If quality fails: try option 3 (KinyaTTS). Only consider option 2 if a
   specific cloned voice is required.
