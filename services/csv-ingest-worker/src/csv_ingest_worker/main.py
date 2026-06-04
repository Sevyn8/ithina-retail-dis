"""Entrypoint: wire the dependencies, require the wiring, run the pull loop.

Exit codes (the mirror-sync pattern): 0 clean shutdown, 2 configuration error
(missing required env, absent subscription — both loud, never defaulted).
"""

from __future__ import annotations

import asyncio

from csv_ingest_worker.audit import WorkerAudit
from csv_ingest_worker.config import SERVICE_NAME, WorkerConfig
from csv_ingest_worker.pipeline import IngestPipeline
from csv_ingest_worker.publisher import PubsubPublisher
from csv_ingest_worker.subscriber import Subscriber
from dis_audit import AuditBackend, select_writer
from dis_core.errors import CsvIngestError
from dis_core.logging import configure_logging, get_logger
from dis_rls import create_rls_engine
from dis_storage import StorageClient

EXIT_OK = 0
EXIT_CONFIG = 2

_log = get_logger(SERVICE_NAME)


async def _run() -> int:
    config = WorkerConfig.from_env()
    engine = create_rls_engine(config.postgres_url)
    try:
        pipeline = IngestPipeline(
            engine=engine,
            storage=StorageClient(bucket=config.bronze_bucket),
            publisher=PubsubPublisher(project_id=config.pubsub_project_id),
            audit=WorkerAudit(select_writer(AuditBackend.POSTGRES, engine=engine)),
            bronze_bucket=config.bronze_bucket,
            pii_backend=None,  # v1.0: NO real backend exists; the gate fails loud (D40)
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
    except CsvIngestError as exc:
        _log.bind(stage="startup").error("configuration error; exiting: %s", exc)
        return EXIT_CONFIG
    except KeyboardInterrupt:  # pragma: no cover - operator stop
        return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
