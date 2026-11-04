from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes.aliases import router as aliases_router
from app.api.routes.statements import router as statements_router
from app.api.routes.transactions import router as transactions_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.services.pdf_extraction import delete_expired_statement_files


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    settings.storage_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    delete_expired_statement_files(settings.storage_dir, settings.file_retention_days)
    yield


configure_logging()
settings = get_settings()
app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
app.include_router(statements_router)
app.include_router(aliases_router)
app.include_router(transactions_router)


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok"}
