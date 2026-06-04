"""The csv.received subscriber: pull loop, terminal-vs-transient routing, ack/nack.

Startup REQUIRES the subscription to exist and raises loudly if it does not —
provisioning lives in ``tools/local/create_topics.py`` (``make topics-create``),
NEVER in worker runtime code, so an absent subscription is a configuration error,
not a silent auto-repair. Cloud subscription wiring is deferred infra; the runtime
client refuses to run without ``PUBSUB_EMULATOR_HOST``.

Message routing:

- terminal (contract/content) failures — a malformed envelope, a path/identity
  mismatch, a detected PII column with no backend — are ACKed after the loud error:
  a redelivery would fail identically (the pipeline already emitted the FAILURE
  audit). Preflight failure is handled INSIDE the pipeline (FAILED bronze row) and
  acks via the normal outcome path.
- everything else (DB/GCS/publish unreachable) is transient: logged and NACKed for
  redelivery, which converges via the idempotency path (D59). The error is handled
  by the messaging layer, not swallowed (code-quality rule 6).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

from csv_ingest_worker.config import (
    CSV_RECEIVED_SUBSCRIPTION,
    SERVICE_NAME,
)
from csv_ingest_worker.envelope import parse_csv_received
from csv_ingest_worker.pipeline import IngestPipeline
from dis_core.errors import (
    CsvIngestError,
    EventContractError,
    EventPathMismatchError,
    PiiBackendNotConfiguredError,
)
from dis_core.logging import get_logger

if TYPE_CHECKING:
    from google.cloud import pubsub_v1

_log = get_logger(SERVICE_NAME)

Decision = Literal["ack", "nack"]

# Contract/content failures: redelivery fails identically, so ack (terminal).
_TERMINAL = (EventContractError, EventPathMismatchError, PiiBackendNotConfiguredError)


async def process_message(pipeline: IngestPipeline, data: bytes) -> Decision:
    """Route one raw message body: parse, process, decide ack/nack."""
    try:
        event = parse_csv_received(data)
    except EventContractError as exc:
        _log.bind(stage="intake", tenant_id=exc.tenant_id, trace_id=exc.trace_id).error(
            "csv.received envelope rejected (terminal): %s", exc
        )
        return "ack"

    log = _log.bind(stage="intake", tenant_id=str(event.tenant_id), trace_id=str(event.trace_id))
    try:
        outcome = await pipeline.process(event)
    except _TERMINAL as exc:
        log.error("terminal ingest failure (acked; FAILURE audit emitted): %s", exc)
        return "ack"
    except Exception as exc:
        log.error("transient ingest failure (nacked for redelivery; idempotency converges): %s", exc)
        return "nack"
    log.info("processed: %s", outcome.disposition)
    return "ack"


@dataclass
class Subscriber:
    """The long-running pull loop over the worker's csv.received subscription."""

    project_id: str
    pipeline: IngestPipeline
    max_messages: int = 10

    def __post_init__(self) -> None:
        import os

        if not os.environ.get("PUBSUB_EMULATOR_HOST"):
            raise CsvIngestError(
                "PUBSUB_EMULATOR_HOST is not set; refusing to subscribe to real Pub/Sub "
                "(cloud wiring is deferred infra)"
            )
        from google.cloud import pubsub_v1

        self._client = pubsub_v1.SubscriberClient()
        self._sub_path = self._client.subscription_path(self.project_id, CSV_RECEIVED_SUBSCRIPTION)
        self._require_subscription()

    def _require_subscription(self) -> None:
        """Fail loud at startup when the subscription is absent (errors, never skips).

        Provisioning is `make topics-create` (tools/local/create_topics.py) — the
        worker never creates its own subscription (no silent auto-repair).
        """
        from google.api_core.exceptions import NotFound

        try:
            self._client.get_subscription(request={"subscription": self._sub_path})
        except NotFound as exc:
            raise CsvIngestError(
                f"subscription {CSV_RECEIVED_SUBSCRIPTION!r} does not exist on project "
                f"{self.project_id!r}; run `make topics-create` to provision it"
            ) from exc

    def _pull(self) -> Any:
        return self._client.pull(
            request={"subscription": self._sub_path, "max_messages": self.max_messages},
            timeout=10,
        )

    async def poll_once(self) -> int:
        """One pull + process + ack/nack pass. Returns the number of messages handled."""
        response = await asyncio.to_thread(self._pull)
        ack_ids: list[str] = []
        nack_ids: list[str] = []
        received: list[pubsub_v1.types.ReceivedMessage] = list(response.received_messages)
        for message in received:
            decision = await process_message(self.pipeline, message.message.data)
            (ack_ids if decision == "ack" else nack_ids).append(message.ack_id)
        if ack_ids:
            await asyncio.to_thread(
                self._client.acknowledge,
                request={"subscription": self._sub_path, "ack_ids": ack_ids},
            )
        if nack_ids:
            # Deadline 0 = immediate redelivery (the emulator honours it); the
            # idempotency path absorbs the replay.
            await asyncio.to_thread(
                self._client.modify_ack_deadline,
                request={
                    "subscription": self._sub_path,
                    "ack_ids": nack_ids,
                    "ack_deadline_seconds": 0,
                },
            )
        return len(received)

    async def run_forever(self) -> None:  # pragma: no cover - thin loop over poll_once
        log = _log.bind(stage="subscriber")
        log.info("subscribed; pulling from %s", self._sub_path)
        while True:
            try:
                await self.poll_once()
            except Exception:
                # The loop must survive transient pull/transport errors; each
                # message's own routing already decided ack/nack.
                log.exception("poll pass failed; retrying")
                await asyncio.sleep(1)
