from fastapi import FastAPI

from app.core.config import get_settings
from app.core.errors import AppError, app_error_handler, unhandled_error_handler
from app.core.logging import configure_logging
from app.core.responses import Result, success


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        docs_url="/docs" if settings.enable_docs else None,
        redoc_url="/redoc" if settings.enable_docs else None,
        openapi_url="/openapi.json" if settings.enable_docs else None,
    )

    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)

    @app.get(f"{settings.api_v1_prefix}/health", response_model=Result[dict[str, str]])
    async def health() -> Result[dict[str, str]]:
        return success(
            {
                "status": "ok",
                "appName": settings.app_name,
                "version": settings.app_version,
                "environment": settings.environment,
            }
        )

    return app


app = create_app()

