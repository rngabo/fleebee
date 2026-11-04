import pytest
from fastapi import HTTPException

from app.core.config import Settings
from app.core.security import require_api_key
from app.main import app


def test_health_route_is_public() -> None:
    route = next(route for route in app.routes if route.path == "/health")
    assert route.dependant.dependencies == []


def test_api_key_authentication_rejects_missing_key() -> None:
    settings = Settings(api_key="test-api-key-at-least-sixteen-characters", database_url="sqlite://")
    with pytest.raises(HTTPException) as error:
        require_api_key(None, settings)
    assert error.value.status_code == 401


def test_api_key_authentication_accepts_matching_key() -> None:
    key = "test-api-key-at-least-sixteen-characters"
    require_api_key(key, Settings(api_key=key, database_url="sqlite://"))

