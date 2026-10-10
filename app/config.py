import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Project root is parent of app/
PROJECT_ROOT = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-3-5-sonnet-20241022"
    chunk_size: int = 800
    chunk_overlap: int = 120
    top_k: int = 5
    max_file_size_bytes: int = 25 * 1024 * 1024  # 25 MB
    
    # Paths
    data_dir: Path = PROJECT_ROOT / "data"
    chroma_dir: Path = PROJECT_ROOT / "data" / "chroma"
    db_path: Path = PROJECT_ROOT / "data" / "ashh.db"
    
    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()

# Ensure data directories exist
settings.data_dir.mkdir(parents=True, exist_ok=True)
settings.chroma_dir.mkdir(parents=True, exist_ok=True)
