from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Fleebee Bank Statement Service"
    app_env: str = "development"
    api_key: str = Field(min_length=16)
    database_url: str = "postgresql+psycopg://bank_statement:change-me@localhost:5432/bank_statement"
    storage_dir: Path = Path("storage")
    max_upload_bytes: int = Field(default=10 * 1024 * 1024, ge=1024)
    file_retention_days: int = Field(default=30, ge=0)
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]

