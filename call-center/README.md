# Fleebee Call Center

Kinyarwanda voice-agent microservice for calling bikers.

Fleebee today sends SMS to riders through the Android phone gateway. This
service adds the next channel: **calling a biker when needed, speaking to
them in Kinyarwanda, listening to their reply in Kinyarwanda, and storing
the important information from what they said.**

All bikers speak Kinyarwanda, so the whole voice loop — prompts, recognition,
responses — must work in Kinyarwanda, not English.

## Status

`2026-07-23` — milestone 1 (TTS proof of concept) is technically working:
`facebook/mms-tts-kin` runs locally in `.venv/` and generated the Kinyarwanda
samples in [samples/](./samples/) via [synthesize.py](./synthesize.py).
Synthesis is ~5x faster than real-time on this laptop's CPU, so live-call
generation is feasible.

**Call content comes from the existing Fleebee SMS templates** (the
`SmsTemplate` table managed by the operator in the dashboard).
[speak_templates.py](./speak_templates.py) loads them, fills the
`{{firstName}}`/`{{plate}}`/etc. placeholders per biker, and synthesizes each
one. Source order: the Fleebee SQLite database, then
[templates.snapshot.json](./templates.snapshot.json) — a copy of the 17 real
production templates taken from the dashboard on `2026-07-23` (re-export it
when templates change) — then the code defaults. All 17 production texts are
rendered as WAVs in [samples/templates/](./samples/templates/).

**Pending: a Kinyarwanda speaker must listen to the samples and judge
intelligibility/tone before milestone 2.** Listen especially to how it reads
plate numbers ("RAC 123 B"), amounts ("5000"), and dates ("2026-08-01") —
digits and Latin letter sequences are the most likely failure points.

Model research so far:

- Speaking (TTS): [TTS_MODEL_OPTIONS.md](./TTS_MODEL_OPTIONS.md)
- Listening (STT): [STT_MODEL_OPTIONS.md](./STT_MODEL_OPTIONS.md)

## Intended Shape

Following the Fleebee design principle (backend is the control plane, devices
are replaceable workers):

```text
Fleebee Backend (control plane)
  - decides WHEN a biker needs a call and WHAT it is about
    |
    v
call-center service (this folder)
  1. TTS   — synthesize the Kinyarwanda prompt/response
  2. STT   — transcribe what the biker says
  3. Logic — understand the reply, decide the next thing to say
  4. Store — extract the important information and save it
             (delivery confirmations, problems, availability, etc.)
    |
    ^ two-way audio during the call
    v
Call delivery channel (to be decided:
  Android phone dial-out, SIP/VoIP provider, etc.)
    |
    v
Biker's phone
```

The stored information flows back to the Fleebee backend so operators see it
in the dashboard next to the SMS history.

## Milestones

1. **TTS proof of concept** — generate an intelligible Kinyarwanda `.wav` on
   this machine's CPU from a realistic dispatch phrase. *(current milestone)*
2. **STT proof of concept** — record a Kinyarwanda phrase, transcribe it
   locally, judge accuracy on real biker-style speech (names, places,
   numbers, plate numbers).
3. **Conversation loop offline** — TTS question → recorded answer → STT →
   simple logic → TTS follow-up, all without telephony. Includes extracting
   structured fields from the reply and saving them.
4. **Fleebee integration** — backend triggers a call job; captured info is
   stored and visible to the operator.
5. **Telephony** — choose and wire the real call channel (Android dial-out
   like the SMS gateway, or SIP/VoIP provider).

## First Milestone: TTS Proof of Concept

Done on the technical side (`2026-07-23`):

1. ~~Create a Python virtual environment in this folder.~~ → `.venv/`
   (Python 3.13.7, torch 2.13 CPU, transformers 5.14, scipy 1.18)
2. ~~Install `transformers`, `torch`, `scipy`.~~
3. ~~Run `facebook/mms-tts-kin` to produce WAV files.~~ →
   [synthesize.py](./synthesize.py) generated [samples/](./samples/):
   greeting, a dispatch phrase, and a yes/no question.
4. **Listen and judge intelligibility and prosody with a Kinyarwanda
   speaker.** ← current step
5. Only if quality is insufficient, escalate to KinyaTTS.

To regenerate or try new phrases:

```bash
cd call-center
.venv/bin/python synthesize.py                          # default samples/
.venv/bin/python synthesize.py "Andika interuro hano" out.wav

# Speak the real Fleebee templates (what calls will actually say):
.venv/bin/python speak_templates.py --list              # preview rendered texts
.venv/bin/python speak_templates.py                     # synthesize all active
.venv/bin/python speak_templates.py --stage PICKUP_SCHEDULED \
    --first-name Jean --plate "RAD 456 C"
```

Environment note: Coqui-based options would require a separate Python
3.10/3.11 environment (pyenv), because Coqui TTS is abandoned and does not
support Python 3.13.

## Non-Goals For Now

- No telephony / call placement yet — prove TTS and STT quality first.
- No API server yet.
- No Fleebee backend changes yet.

## Where To Look Next

- TTS model options and test plan: [TTS_MODEL_OPTIONS.md](./TTS_MODEL_OPTIONS.md)
- STT model options and test plan: [STT_MODEL_OPTIONS.md](./STT_MODEL_OPTIONS.md)
- Overall project progress log: [../progress.md](../progress.md)
- Fleebee architecture: [../architecture.md](../architecture.md)
