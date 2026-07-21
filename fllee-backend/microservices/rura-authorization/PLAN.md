# RURA Authorization Microservice Plan

## Goal

Automate authorization follow-up so Fleebee can regularly check whether a bike authorization is still pending or has been completed on the RURA platform.

## Target source

- `https://licensing.rura.rw/operator-landing-page`

## Expected inputs

- bike plate number
- chassis number when needed
- any login or operator credentials required by the RURA flow

## Expected outputs

- authorization status
- last checked time
- raw source snapshot or parsed status note
- any relevant reference number if exposed

## Phase plan

### Phase 1

- document the exact operator workflow on RURA
- confirm whether the needed data can be accessed by stable navigation or network requests
- identify authentication, tokens, anti-bot, or session requirements

### Phase 2

- create a standalone service that:
  - accepts plate or bike identifiers
  - checks current authorization status
  - normalizes the result into `pending`, `in progress`, or `completed`
  - stores raw check notes for audit

### Phase 3

- connect the service to Fleebee workflow records
- update bike authorization status automatically
- create workflow progress notes when status changes
- trigger the correct stage-based SMS only when a meaningful state change occurs

### Phase 4

- add monitoring and retry behavior:
  - last successful check
  - last failed check
  - queue length if many bikes are pending
  - alerts when the RURA structure changes and parsing breaks

## Important concerns

- credential security
- session expiration
- page structure instability
- rate limiting
- avoiding duplicate notifications when a status has not actually changed

## Recommended implementation boundary

Keep this as a separate service so:

- RURA automation remains isolated from the main Fleebee request path
- failures or login issues do not crash the operator dashboard
- authorization polling can evolve independently from ordinary SMS features
