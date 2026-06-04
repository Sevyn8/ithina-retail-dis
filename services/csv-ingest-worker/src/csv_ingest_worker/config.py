"""Environment-resolved configuration for the worker.

Required env (no silent default for a required value, code-quality rule 4 — a
missing one raises ``CsvIngestError``):

- ``POSTGRES_URL`` — the DIS write connection (``ithina_dis_user``). Reused by
  ``dis-rls`` ``create_rls_engine``, which positively asserts
  ``current_database()=='ithina_dis_db'`` (DIS on 5433, never Customer Master).
- ``PUBSUB_PROJECT_ID`` — the Pub/Sub project for the subscriber and publisher.
- ``GCS_BUCKET_BRONZE`` — the expected bronze bucket. The event's ``gcs_uri`` is
  split by ``dis-storage`` ``split_object_uri`` and the split-out bucket is
  cross-checked against this value (a mismatched bucket is a malformed producer).

The topic/subscription names are frozen-contract constants, not deployment config:
``csv.received`` is the trigger (D54), ``ingress.ready`` the publish target (hard
rule 10), and the subscription is provisioned by ``tools/local/create_topics.py``
(`make topics-create`) — NEVER by worker runtime code, so an absent subscription
is a loud startup error, not a silent auto-repair.

The dedup window is a decision value (24h, build-guide Slice 9b), not config.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from dis_core.errors import CsvIngestError

_POSTGRES_URL = "POSTGRES_URL"
_PUBSUB_PROJECT_ID = "PUBSUB_PROJECT_ID"
_GCS_BUCKET_BRONZE = "GCS_BUCKET_BRONZE"

SERVICE_NAME = "csv-ingest-worker"

# Frozen contract names (hard rule 10) and the worker's subscription on the trigger
# topic. Provisioned locally by tools/local/create_topics.py alongside the topics.
CSV_RECEIVED_TOPIC = "csv.received"
INGRESS_READY_TOPIC = "ingress.ready"
CSV_RECEIVED_SUBSCRIPTION = "csv-ingest-worker.csv.received"

# The idempotency window (decisions/build-guide: same content hash + upload session +
# tenant within 24h returns the prior trace_id). Measured against the prior bronze
# row's received_at — the only NOT NULL persisted timestamp, server-side and
# monotonic; the event's received_ts is producer-controlled and would skew under
# redelivery / late delivery.
DEDUP_WINDOW_HOURS = 24


@dataclass(frozen=True)
class WorkerConfig:
    """Resolved environment profile for one worker process."""

    postgres_url: str
    pubsub_project_id: str
    bronze_bucket: str

    @classmethod
    def from_env(cls) -> WorkerConfig:
        """Resolve from the environment, raising on any missing required value."""
        postgres_url = os.environ.get(_POSTGRES_URL)
        if not postgres_url:
            raise CsvIngestError(
                f"{_POSTGRES_URL} is not set; cannot reach the DIS database for the bronze write"
            )
        pubsub_project_id = os.environ.get(_PUBSUB_PROJECT_ID)
        if not pubsub_project_id:
            raise CsvIngestError(
                f"{_PUBSUB_PROJECT_ID} is not set; cannot subscribe to "
                f"{CSV_RECEIVED_TOPIC!r} or publish {INGRESS_READY_TOPIC!r}"
            )
        bronze_bucket = os.environ.get(_GCS_BUCKET_BRONZE)
        if not bronze_bucket:
            raise CsvIngestError(
                f"{_GCS_BUCKET_BRONZE} is not set; cannot cross-check the event's "
                "gcs_uri bucket or read the uploaded object"
            )
        return cls(
            postgres_url=postgres_url,
            pubsub_project_id=pubsub_project_id,
            bronze_bucket=bronze_bucket,
        )
