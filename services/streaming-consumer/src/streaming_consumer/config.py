"""Environment-resolved configuration for the consumer.

Required env (no silent default for a required value, code-quality rule 4 — a
missing one raises ``DisError``; this service deliberately defines no new error
class because ``libs/dis-core`` is outside its blast radius; a
``StreamingConsumerError`` family is a registered want for the next
dis-core-touching slice):

- ``POSTGRES_URL`` — the DIS write connection (``ithina_dis_user``). Reused by
  ``dis-rls`` ``create_rls_engine``, which positively asserts
  ``current_database()=='ithina_dis_db'`` (DIS on 5433, never Customer Master).
- ``PUBSUB_PROJECT_ID`` — the Pub/Sub project for the subscriber.
- ``GCS_BUCKET_BRONZE`` — the expected bronze bucket. The event's ``gcs_uri`` is
  split by ``dis-storage`` ``split_object_uri`` and cross-checked against this.

The topic/subscription names are frozen-contract constants, not deployment config:
``ingress.ready`` is the trigger (hard rule 10) and the subscription is provisioned
by ``tools/local/create_topics.py`` (``make topics-create``) — NEVER by consumer
runtime code, so an absent subscription is a loud startup error.

``BATCH_SIZE_ROW_PAIRS`` is the architecture-4.6 per-tenant transaction grain
(~500 row-pairs); the rollback unit of the atomic dual-write (D30 holds per batch).
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from dis_core.errors import DisError

_POSTGRES_URL = "POSTGRES_URL"
_PUBSUB_PROJECT_ID = "PUBSUB_PROJECT_ID"
_GCS_BUCKET_BRONZE = "GCS_BUCKET_BRONZE"

SERVICE_NAME = "streaming-consumer"

# Frozen contract names (hard rule 10) and this consumer's subscription on the
# trigger topic. Provisioned locally by tools/local/create_topics.py.
INGRESS_READY_TOPIC = "ingress.ready"
INGRESS_READY_SUBSCRIPTION = "streaming-consumer.ingress.ready"

# Architecture 4.6: manual batching, ~500 rows per per-tenant transaction. One
# ingress chunk carries one tenant, so batches are chunk-sequential; each batch is
# the either-or-neither rollback unit (D30 at batch grain; redelivery + D33
# read-time dedup + the D64 conditional upsert converge a partially-landed chunk).
BATCH_SIZE_ROW_PAIRS = 500


@dataclass(frozen=True)
class ConsumerConfig:
    """Resolved environment profile for one consumer process."""

    postgres_url: str
    pubsub_project_id: str
    bronze_bucket: str

    @classmethod
    def from_env(cls) -> ConsumerConfig:
        """Resolve from the environment, raising on any missing required value."""
        postgres_url = os.environ.get(_POSTGRES_URL)
        if not postgres_url:
            raise DisError(
                f"{_POSTGRES_URL} is not set; cannot reach the DIS database for the canonical dual-write"
            )
        pubsub_project_id = os.environ.get(_PUBSUB_PROJECT_ID)
        if not pubsub_project_id:
            raise DisError(f"{_PUBSUB_PROJECT_ID} is not set; cannot subscribe to {INGRESS_READY_TOPIC!r}")
        bronze_bucket = os.environ.get(_GCS_BUCKET_BRONZE)
        if not bronze_bucket:
            raise DisError(
                f"{_GCS_BUCKET_BRONZE} is not set; cannot cross-check the event's "
                "gcs_uri bucket or read the bronze object"
            )
        return cls(
            postgres_url=postgres_url,
            pubsub_project_id=pubsub_project_id,
            bronze_bucket=bronze_bucket,
        )
