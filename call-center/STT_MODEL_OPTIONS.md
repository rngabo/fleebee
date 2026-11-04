# Kinyarwanda STT (Speech-to-Text) Model Options

Researched `2026-07-23`. The service must transcribe what bikers say in
Kinyarwanda (milestone 2). Kinyarwanda is comparatively well served for a
low-resource language because Mozilla Common Voice has one of its largest
datasets in Kinyarwanda, and the Mbaza NLP community (Rwanda) maintains
models on Hugging Face.

Exact checkpoint names should be re-verified on Hugging Face before
installing — the candidates below are ordered by expected ease of setup.

## Option 1 — mbazaNLP/Whisper-Small-Kinyarwanda (start here)

OpenAI Whisper (small) fine-tuned for Kinyarwanda by the Mbaza NLP
community. Runs with the same Transformers stack as our TTS choice.

- Reported word error rate around 33% — usable for short, guided replies
  but expect mistakes on free-form speech
- CPU-friendly at the `small` size
- Same `pip install transformers torch` environment as `facebook/mms-tts-kin`

## Option 2 — mbazaNLP NeMo Conformer STT

`Kinyarwanda_nemo_stt_conformer_model` — an NVIDIA NeMo conformer model
from the same community, trained on Common Voice Kinyarwanda.

- Likely better accuracy than Whisper-small for Kinyarwanda
- Requires installing the NeMo toolkit, which is heavier than Transformers

## Option 3 — Meta MMS ASR (facebook/mms-1b-all, `kin` adapter)

The ASR side of the same MMS project as our TTS model. One large multilingual
model (~1B params) with per-language adapters including Kinyarwanda.

- Same Transformers ecosystem, symmetric with the TTS choice
- Bigger download and slower on CPU than Whisper-small

## Option 4 — SpeechBrain wav2vec2 (Common Voice Kinyarwanda)

SpeechBrain publishes a wav2vec2 ASR model trained on Common Voice
Kinyarwanda. A reasonable alternative if the ones above disappoint;
requires the SpeechBrain library.

## Design Note: Constrain What Bikers Say

Whatever the model, accuracy improves dramatically when replies are guided.
For biker calls, prefer prompts that expect short, predictable answers:

- "Wagejeje ibicuruzwa? Vuga YEGO cyangwa OYA." (yes/no)
- Numbers, plate numbers, and place names are the risky part — test these
  specifically in the STT proof of concept.

## Test Plan (Milestone 2)

1. Reuse the TTS venv; install the option 1 model.
2. Record 5–10 short Kinyarwanda phrases a biker would realistically say
   (confirmations, problems, place names, numbers) on this machine's mic
   or a phone voice note (16 kHz mono WAV).
3. Transcribe with option 1; count word errors, and separately note whether
   the *meaning* (yes/no, the number, the place) was captured.
4. If meaning-level accuracy is poor, repeat with option 2 (NeMo conformer)
   before considering the heavier options.
5. Record sample phrases and verdicts in this file.

## Sources

- [mbazaNLP on Hugging Face](https://huggingface.co/mbazaNLP)
- [mbazaNLP/Whisper-Small-Kinyarwanda](https://huggingface.co/mbazaNLP/Whisper-Small-Kinyarwanda)
- [Fine-Tuning Whisper for Kinyarwanda (paper)](https://www.researchgate.net/publication/390941288_Fine-Tuning_Whisper_for_Kinyarwanda_A_Practical_Approach_to_Low-Resource_ASR_Development)
- [Edge-based speech transcription/synthesis for Kinyarwanda & Swahili (paper)](https://arxiv.org/html/2510.16497v1)
- [KinyarwandaVA — NeMo ASR + VITS2 voice assistant example](https://github.com/uwimfuraz/KINYARWANDAVA)
