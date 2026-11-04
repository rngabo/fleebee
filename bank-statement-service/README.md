# Fleebee Bank Statement Service

Independent FastAPI microservice for deterministic extraction of incoming Bank of Kigali transactions. It stores statement files privately, persists data in PostgreSQL, links duplicates across overlapping statements, flags ambiguous depositor names for review, reconciles statement totals, and exports the exact `Date, Depositor Name, Amount` CSV view.

## Run with Docker

```bash
cp .env.example .env
# Set API_KEY, POSTGRES_PASSWORD, and use the same password in DATABASE_URL.
docker compose up --build
```

The API listens on `http://localhost:8100`; OpenAPI is at `/docs` and health is at `/health`. All `/api/v1/*` endpoints require `X-API-Key`.

```bash
curl -H 'X-API-Key: your-secret' \
  -F 'file=@statement.pdf;type=application/pdf' \
  http://localhost:8100/api/v1/statements/upload

curl -H 'X-API-Key: your-secret' \
  'http://localhost:8100/api/v1/statements/STATEMENT_ID/export?format=csv' \
  --output transactions.csv

curl -X PATCH -H 'X-API-Key: your-secret' -H 'Content-Type: application/json' \
  -d '{"depositor_name":"Correct Name","correction_source":"operator"}' \
  http://localhost:8100/api/v1/transactions/TRANSACTION_ID
```

## Architecture

- `parsers/` contains the bank adapter contract and BK positional parser; it has no HTTP or persistence logic.
- `services/name_extraction.py` applies explicit narration-specific rules and never guesses missing senders.
- `services/statement_processor.py` coordinates an atomic database import and cross-statement duplicate linking.
- `api/routes/` owns transport, pagination, filters, correction, and CSV responses.
- Uploaded PDFs are UUID-named, mode `0600`, and kept outside public web roots.

The BK adapter groups PDF words by coordinates, starts a transaction only when Book Date and Value Date are present, and appends following rows to the narration. This handles the supplied five-page JasperReports statement, including wrapped narration and page breaks.

## Tests

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/pytest
```

For an opt-in validation against a private real statement without copying it into the repository:

```bash
BK_SAMPLE_PDF=/private/path/statement.pdf .venv/bin/pytest tests/test_bk_parser.py
```

Do not commit real statements or credentials. Accuracy targets should be measured against a separate anonymized, labeled corpus before adding another bank adapter.
