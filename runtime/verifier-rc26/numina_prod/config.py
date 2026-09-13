from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import os


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1","true","yes","on"}


@dataclass(frozen=True)
class Settings:
    environment: str
    role: str
    release: str
    data_dir: Path
    signing_key_file: Path | None
    allow_ephemeral_key: bool
    require_frozen_core: bool
    public_url: str | None
    database_url: str | None
    real_funds_enabled: bool
    employer_ip_enabled: bool
    trusted_hosts: tuple[str, ...]
    database_tls_required: bool = False
    database_connect_timeout_seconds: int = 5
    database_statement_timeout_ms: int = 5000
    database_lock_timeout_ms: int = 2000
    database_max_retries: int = 4
    public_execution_api_enabled: bool = False
    runtime_controls_configurable: bool = True
    testnet_execution_enabled: bool = False
    circle_testnet_submit_enabled: bool = False
    circle_cli_path: str = "circle"
    circle_submit_timeout_seconds: int = 180
    circle_testnet_max_usdc: str = "2"
    circle_allowed_testnet_chains: tuple[str, ...] = ("ARC-TESTNET",)
    arc_verification_enabled: bool = True
    arc_rpc_urls: tuple[str, ...] = ("https://rpc.testnet.arc.network", "https://rpc.quicknode.testnet.arc.network", "https://rpc.blockdaemon.testnet.arc.network")
    arc_rpc_quorum: int = 2
    arc_rpc_timeout_seconds: int = 10
    arc_chain_id: int = 5042002
    arc_usdc_system_contract: str = "0x3600000000000000000000000000000000000000"
    arc_required_confirmations: int = 1
    evidence_network_enabled: bool = True
    evidence_job_ttl_seconds: int = 3600
    evidence_database_url: str | None = None
    evidence_require_durable: bool = False

    @property
    def production(self) -> bool:
        return self.environment == "production"


def load_settings() -> Settings:
    environment=os.getenv("NUMINA_ENV","development").strip().lower()
    role=os.getenv("NUMINA_ROLE","public-verifier").strip().lower()
    if environment not in {"development","test","staging","production"}:
        raise RuntimeError("NUMINA_ENV must be development, test, staging, or production")
    if role not in {"public-verifier","authority-node","witness"}:
        raise RuntimeError("NUMINA_ROLE must be public-verifier, authority-node, or witness")

    real_funds=_bool("NUMINA_REAL_FUNDS_ENABLED",False)
    employer_ip=_bool("NUMINA_EMPLOYER_IP_ENABLED",False)
    key=os.getenv("NUMINA_SIGNING_KEY_FILE")
    hosts=tuple(x.strip() for x in os.getenv("NUMINA_TRUSTED_HOSTS","localhost,127.0.0.1,testserver").split(",") if x.strip())
    settings=Settings(
        environment=environment,
        role=role,
        release=os.getenv("NUMINA_RELEASE","core-v1.8+prod-v1.9.0-rc26"),
        data_dir=Path(os.getenv("NUMINA_DATA_DIR","/tmp/numina")),
        signing_key_file=Path(key) if key else None,
        allow_ephemeral_key=_bool("NUMINA_ALLOW_EPHEMERAL_KEY", environment != "production"),
        require_frozen_core=_bool("NUMINA_REQUIRE_FROZEN_CORE",True),
        public_url=os.getenv("NUMINA_PUBLIC_URL"),
        database_url=os.getenv("NUMINA_DATABASE_URL") or os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL"),
        real_funds_enabled=real_funds,
        employer_ip_enabled=employer_ip,
        trusted_hosts=hosts,
        database_tls_required=_bool("NUMINA_DATABASE_TLS_REQUIRED", environment == "production"),
        database_connect_timeout_seconds=int(os.getenv("NUMINA_DATABASE_CONNECT_TIMEOUT_SECONDS","5")),
        database_statement_timeout_ms=int(os.getenv("NUMINA_DATABASE_STATEMENT_TIMEOUT_MS","5000")),
        database_lock_timeout_ms=int(os.getenv("NUMINA_DATABASE_LOCK_TIMEOUT_MS","2000")),
        database_max_retries=int(os.getenv("NUMINA_DATABASE_MAX_RETRIES","4")),
        public_execution_api_enabled=_bool("NUMINA_PUBLIC_EXECUTION_API_ENABLED",False),
        runtime_controls_configurable=True,
        testnet_execution_enabled=_bool("NUMINA_TESTNET_EXECUTION_ENABLED", environment != "production"),
        circle_testnet_submit_enabled=_bool("NUMINA_CIRCLE_TESTNET_SUBMIT_ENABLED",False),
        circle_cli_path=os.getenv("NUMINA_CIRCLE_CLI_PATH","circle").strip() or "circle",
        circle_submit_timeout_seconds=int(os.getenv("NUMINA_CIRCLE_SUBMIT_TIMEOUT_SECONDS","180")),
        circle_testnet_max_usdc=os.getenv("NUMINA_CIRCLE_TESTNET_MAX_USDC","2").strip() or "2",
        circle_allowed_testnet_chains=tuple(x.strip().upper() for x in os.getenv("NUMINA_CIRCLE_ALLOWED_TESTNET_CHAINS","ARC-TESTNET").split(",") if x.strip()),
        arc_verification_enabled=_bool("NUMINA_ARC_VERIFICATION_ENABLED", True),
        arc_rpc_urls=tuple(x.strip() for x in os.getenv("NUMINA_ARC_RPC_URLS","https://rpc.testnet.arc.network,https://rpc.quicknode.testnet.arc.network,https://rpc.blockdaemon.testnet.arc.network").split(",") if x.strip()),
        arc_rpc_quorum=int(os.getenv("NUMINA_ARC_RPC_QUORUM","2")),
        arc_rpc_timeout_seconds=int(os.getenv("NUMINA_ARC_RPC_TIMEOUT_SECONDS","10")),
        arc_chain_id=int(os.getenv("NUMINA_ARC_CHAIN_ID","5042002")),
        arc_usdc_system_contract=os.getenv("NUMINA_ARC_USDC_SYSTEM_CONTRACT","0x3600000000000000000000000000000000000000").strip(),
        arc_required_confirmations=int(os.getenv("NUMINA_ARC_REQUIRED_CONFIRMATIONS","1")),
        evidence_network_enabled=_bool("NUMINA_EVIDENCE_NETWORK_ENABLED", True),
        evidence_job_ttl_seconds=int(os.getenv("NUMINA_EVIDENCE_JOB_TTL_SECONDS","3600")),
        evidence_database_url=(os.getenv("NUMINA_EVIDENCE_DATABASE_URL") or os.getenv("NUMINA_DATABASE_URL") or os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL")),
        evidence_require_durable=_bool("NUMINA_EVIDENCE_REQUIRE_DURABLE", environment == "production"),
    )
    if settings.arc_verification_enabled:
        if not settings.arc_rpc_urls:
            raise RuntimeError("NUMINA_ARC_RPC_URLS requires at least one endpoint")
        if settings.arc_rpc_quorum < 1 or settings.arc_rpc_quorum > len(settings.arc_rpc_urls):
            raise RuntimeError("NUMINA_ARC_RPC_QUORUM must be between 1 and the configured endpoint count")
        if settings.arc_chain_id != 5042002:
            raise RuntimeError("rc26 independent verifier supports Arc Testnet chain id 5042002 only")
        if not all(url.startswith("https://") for url in settings.arc_rpc_urls):
            raise RuntimeError("NUMINA_ARC_RPC_URLS must use https")
    if settings.production and settings.signing_key_file is None:
        raise RuntimeError("production requires NUMINA_SIGNING_KEY_FILE (app bootstrap may materialize it from NUMINA_SIGNING_KEY_B64)")
    if settings.production and settings.allow_ephemeral_key:
        raise RuntimeError("production forbids ephemeral signing keys")
    if settings.production and settings.evidence_network_enabled and settings.evidence_require_durable and not settings.evidence_database_url:
        raise RuntimeError("production evidence network requires NUMINA_EVIDENCE_DATABASE_URL, NUMINA_DATABASE_URL, DATABASE_URL, or POSTGRES_URL")
    if settings.role == "authority-node" and settings.production:
        if not settings.database_url or not settings.database_url.startswith(("postgresql://","postgresql+psycopg://")):
            raise RuntimeError("production authority-node requires a PostgreSQL database URL")
        if settings.database_tls_required:
            lowered=settings.database_url.lower()
            if not ("sslmode=verify-full" in lowered or "sslmode=verify-ca" in lowered):
                raise RuntimeError("production authority-node requires verified PostgreSQL TLS (sslmode=verify-full or verify-ca)")
        if settings.database_max_retries < 1 or settings.database_max_retries > 10:
            raise RuntimeError("NUMINA_DATABASE_MAX_RETRIES must be between 1 and 10")
        if settings.database_statement_timeout_ms < 100 or settings.database_lock_timeout_ms < 50:
            raise RuntimeError("production database timeouts are below safe minimums")
    return settings
