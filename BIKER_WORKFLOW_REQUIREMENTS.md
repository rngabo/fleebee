# Biker Workflow Requirements

## Purpose

This document captures the real business workflow for recruiting bikers, assigning bikes, tracking paperwork, and notifying recipients automatically.

It should be treated as a living reference for future Fleebee feature work. When a new related feature is added or the process changes, this file should be reviewed and updated first.

## Main Goal

Fleebee should help manage bikers and their bikes from first contact up to delivery, paperwork follow-up, payments, fines, and later bulk communication.

The system should reduce manual SMS work by using prewritten templates and automatic notifications triggered by progress updates.

## Core Business Flow

### 1. Head hunting and first contact

- I look for interested bikers and write down each one, but asking them if they have the right character honnesty, have papers (driving license, no criminal record, any addiction).
- At this stage, I need to store their contact details early.
- The first days after contact may include preparation messages telling them to start looking for an insurer in case of crisis and forecasting when they should get their bike to start operating informing them i have a plan soon.

### 2. Order bikes

- I order a number of bikes equal to the people I have already identified, i would late want to open a link to share with those helping find who is interested ones mentioning things like have driving license A, B, etc and if number of interested candidates exceed after picking those i like, others can be informed to stay in touch for soon opportunities in the next batch.
- These bikers may need to be grouped in a new upcoming batch because they are selected.

### 3. Waiting period

- Bikers start asking for progress updates.
- I usually give them the company timeline, often around 1 week.

### 4. Bike details arrive

- After around 1 week, the company provides:
  - plate number
  - chassis number
  - bike model
- At this point, the biker should be informed that the bike now has a plate.
- Insurance purchase is usually the next step.

### 5. Insurance processing stage

- After plate assignment, I purchase insurance for the bike.
- Bikers can be informed that insurance is being processed or has been completed, informing them to wait for a soon to be anounced date of picking their bikes.
- When insurance process is done, i can ask from the company when to come pick the bikes, and can immediately inform the bikers

### 6. Authorization processing

- After insurance, I apply for authorization on the RURA platform.
- Sometimes authorization is still pending even when the bike is already physically delivered.

### 7. Pickup preparation

- The company calls me to come pick up the bikes.
- Bikers may need instructions about where to meet time, what bring(driving license), when to come, and how to prepare.

### 8. Delivery day coordination

- Bikers should receive notifications or calls telling them to meet at the company day and time.
- They should also be told to prepare to contact their insurers after leaving the company and before or during the trip to the notary office for contract work.

### 9. Notary process

- After receiving bikes from the company, we go together to the notary office.
- At this time, some authorizations may still be pending on RURA.
- some bikers may not at the moment have their insurer and the contract can be done but have pending status since we still to remind the bikers to ask their insurer pass by the notary office to sign

### 10. Post-delivery follow-up

- After everyone goes home with the bikes, each biker should receive a welcome message.
- Anyone still waiting for authorization or any pending issue should be told that authorization is pending and still being processed on RURA.

### 11. Paperwork and payment reminders 

- Each biker should receive updates about:
  - insurance
  - authorization
  - official starting date
  - next payment date
- Payment reminders can be enabled or disabled.

### 12. Traffic fines

- Usually I receive traffic fines before the biker does because i still own the bikes in the period they are leasing before the title transfer without the period of the contract usually 20-24months. fine comes in a the form of sms from Irembo platform on my phone as text, mentioning plate number, reason, paying date
- I need to record:
  - which bike received the fine
  - fine amount
  - fine reason
- Notification should be enabled here by default, the responsible biker should receive an SMS warning them, encouraging timely payment and better care next time. later in fines section i should be able to see them in one place and choose to for a message to them in general warning to be carefull about the frequent offanse.


## plan microservice

- Later we should be able to scrap https://irembo.gov.rw/user/citizen/service/rnp/traffic_fines and enter TIN and plate number to regulary check if have fines. and authorization updates on https://licensing.rura.rw/operator-landing-page

### 13. Bulk reminders and service information

- After one week, one month, or another planned period, I may want to send generic bulk SMS to many bikers about:
  - safety
  - bike service information
  - bike regular maintenance
  - important updates
  - cleanliness
  - avoiding fines

### 14. Emergency communication

- I should be able to send emergency SMS to:
  - all bikers
  - a selected group
  - an individual biker

### 15. Batch-based communication

- Bikers are hired at different times.
- They should be categorized into batches.
- I may need to send a message only to a specific batch, for example:
  - lease end date preparation
  - title transfer preparation
  - tax declaration period
  - avoiding fines
  - safety
  - cleanliness

## Required Data Structure

### Biker / Recipient

Each biker record should include at least:

- full name
- first name
- phone number
- active or inactive status
- preferred language - remove this one
- notifications enabled or disabled - notification is default on each biker, any new change can be updated in other places based on the reason
- batch assignment and if existing batch name
- mention if team leader - who should help inspecting if maintenance is done, follow up when needed, contacting someone...etc.

### Bike Record

Each bike record should include at least:

- linked biker
- plate number
- chassis number
- bike model
- batch
- current progress stage
- insurance status
- authorization status
- company pickup status
- official start date
- next payment date
- operational updates (maintenance)
- notes

### Batch

Each batch should include at least:

- batch name or code
- created date
- expected delivery period
- notes

### Progress Update

Each progress update should include at least:

- bike
- stage
- category
- urgency
- update note
- notify recipient true or false
- created by
- created at

### Fine Record

Each fine should include at least:

- bike
- biker
- fine amount
- fine reason
- fine date
- payment deadline if known
- notification sent status

### SMS Template

Templates should be configurable from the SMS page and should support:

- language - remove default is kinyarwanda now
- stage
- category
- urgency
- active or inactive
- message body
- signature text is always attached since i plan to use another phone number. so they should be informed that if they need to contact me they should call my other number 0788690545 and when to call me.

## Workflow Rules

### Bike creation

- A bike should be created with at least:
  - biker
  - plate number when available
  - chassis number when available
  - bike model when available
- The system should allow the bike to exist before all identifiers are known, then be updated later.

also a section reserved to model and frequently associated problem should be there to decide later which model to avoid

### Notification toggle

- A `Send notification` control should be visible in a reserved area in an appropriate place
- It should stay easy to see during every update flow.
- It should default to checked.
- If checked, saving a progress update should automatically send the corresponding SMS to the active biker.

### Automatic messaging

- On save, the system should select the correct prewritten Kinyarwanda template based on:
  - stage
  - category
  - urgency
- The system should fill placeholders such as:
  - `{{firstName}}`
  - `{{plate}}`
  - `{{chassisNumber}}`
  - `{{bikeModel}}`
  - `{{officialStartDate}}`
  - `{{nextPaymentDate}}`
  - `{{fineAmount}}`
  - `{{fineReason}}`
- The configured SMS signature should be appended automatically.

### SMS configuration

- The SMS page should contain configuration for templates by stage and category.
- This should allow prewriting generic Kinyarwanda SMS for different situations.
- Manual SMS sending should still exist for one-off communication, but most workflow messages should be automatic after saving an update.

### Activity and eligibility

- Only bikers marked `Active` should be candidates to receive workflow SMS.
- A biker with notifications disabled should not receive automatic updates even if the template exists.

## Suggested Stage Groups

These stage groups should guide implementation:

- `LEAD_CAPTURED`
- `PREPARATION`
- `BIKES_ORDERED`
- `WAITING_FOR_COMPANY`
- `PLATE_ASSIGNED`
- `INSURANCE_IN_PROGRESS`
- `INSURANCE_COMPLETED`
- `AUTHORIZATION_IN_PROGRESS`
- `AUTHORIZATION_PENDING`
- `AUTHORIZATION_COMPLETED`
- `PICKUP_READY`
- `PICKUP_SCHEDULED`
- `AT_COMPANY`
- `AT_NOTARY`
- `DELIVERED`
- `WELCOME_SENT`
- `PAYMENT_REMINDER`
- `FINE_RECORDED`
- `BATCH_NOTICE`
- `EMERGENCY_NOTICE`

## Suggested Template Categories

The SMS page should eventually support templates for:

- onboarding
- preparation
- progress update
- insurance
- authorization
- pickup
- notary
- welcome
- payment reminder
- fine notice
- safety
- service information
- cleanliness
- batch notice
- emergency

## Language Direction

- Primary language should support Kinyarwanda.
- Templates should be written in reusable generic form.
- Messages should usually begin with a personalized greeting, for example `Muraho {{firstName}}`.

## Future Feature Direction

This workflow implies future Fleebee features such as:

- bike management page
- batch management
- progress timeline per bike
- automatic SMS on update
- fine tracking
- payment reminder scheduling
- bulk messaging by batch
- stage-based template management from the SMS page

## Change Management Rule

For any future feature update related to bikers, bikes, progress, fines, batches, reminders, or automatic SMS:

1. Review this file first.
2. Update this file if the business process has changed.
3. Only then implement the code and UI changes.
