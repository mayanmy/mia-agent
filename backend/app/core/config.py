import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Settings:
    app_name: str
    app_version: str
    environment: str
    api_v1_prefix: str
    log_level: str
    enable_docs: bool


def _get_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


@lru_cache
def get_settings() -> Settings:
    return Settings(
        app_name=os.getenv("MIA_APP_NAME", "Mia"),
        app_version=os.getenv("MIA_APP_VERSION", "0.1.0"),
        environment=os.getenv("MIA_ENVIRONMENT", "local"),
        api_v1_prefix=os.getenv("MIA_API_V1_PREFIX", "/api/v1"),
        log_level=os.getenv("MIA_LOG_LEVEL", "INFO"),
        enable_docs=_get_bool("MIA_ENABLE_DOCS", True),
    )

