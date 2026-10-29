from __future__ import annotations
from dataclasses import dataclass

SCHEMA_VERSION = 1
SCHEMA_NAME = "numina_authority_commit_store"
MIGRATION_LOCK_KEY = 732897411

@dataclass(frozen=True)
class SchemaStatus:
    schema_name: str
    supported_version: int
    database_version: int | None
    compatible: bool
    dialect: str
    isolation_level: str | None
