"""Entrypoint: wire the dependencies, require the wiring, run the pull loop.

Exit codes (the 9b/mirror-sync pattern): 0 clean shutdown, 2 configuration error
(missing required env, absent subscription, wrong DB target — loud, never
defaulted).

Target safety, asserted positively at startup (the Slice 7 pattern, on top of
dis-rls's own first-use verification): the resolved connection must answer
``current_database() == 'ithina_dis_db'`` — DIS on 5433, never Customer Master.
"""

from __future__ import annotations

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from dis_audit import AuditBackend, select_writer
from dis_core.errors import DisError
from dis_core.logging import configure_logging, get_logger
from dis_quarantine import PostgresQuarantineWriter
from dis_rls import create_rls_engine
from dis_storage import StorageClient
from streaming_consumer.clients.pubsub import Subscriber
from streaming_consumer.config import SERVICE_NAME, ConsumerConfig
from streaming_consumer.orchestrate import ConsumerPipeline
from streaming_consumer.sinks.audit import ConsumerAudit
from streaming_consumer.sinks.quarantine import ConsumerQuarantine

EXIT_OK = 0
EXIT_CONFIG = 2

_EXPECTED_DB = "ithina_dis_db"

_log = get_logger(SERVICE_NAME)


async def _assert_dis_target(engine: AsyncEngine) -> None:
    """Positive target assertion: the one accepted database is the DIS database."""
    async with engine.connect() as conn:
        current = (await conn.execute(text("SELECT current_database()"))).scalar()
    if current != _EXPECTED_DB:
        raise DisError(
            f"connected to {current!r} but the streaming consumer writes canonical "
            f"and requires {_EXPECTED_DB!r} (DIS on 5433, never Customer Master); "
            "check POSTGRES_URL"
        )


async def _run() -> int:
    config = ConsumerConfig.from_env()
    engine = create_rls_engine(config.postgres_url)
    try:
        await _assert_dis_target(engine)
        pipeline = ConsumerPipeline(
            engine=engine,
            storage=StorageClient(bucket=config.bronze_bucket),
            audit=ConsumerAudit(select_writer(AuditBackend.POSTGRES, engine=engine)),
            quarantine=ConsumerQuarantine(PostgresQuarantineWriter(engine)),
            bronze_bucket=config.bronze_bucket,
        )
        subscriber = Subscriber(project_id=config.pubsub_project_id, pipeline=pipeline)
        await subscriber.run_forever()
    finally:
        await engine.dispose()
    return EXIT_OK  # pragma: no cover - run_forever only returns on cancellation


def main() -> int:
    configure_logging()
    try:
        return asyncio.run(_run())
    except DisError as exc:
        _log.bind(stage="startup").error("configuration error; exiting: %s", exc)
        return EXIT_CONFIG
    except KeyboardInterrupt:  # pragma: no cover - operator stop
        return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
