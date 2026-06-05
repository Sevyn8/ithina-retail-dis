"""The ingress.ready subscriber: pull loop + the audit-and-nack disposition.

Startup REQUIRES the subscription to exist and raises loudly if it does not —
provisioning lives in ``tools/local/create_topics.py`` (``make topics-create``),
NEVER in consumer runtime code. Cloud subscription wiring is deferred infra; the
runtime client refuses to run without ``PUBSUB_EMULATOR_HOST``.

Message routing (the Slice 10 minimal failure disposition — see orchestrate.py):

- ``written`` → ack.
- any failed disposition or any raised pipeline error → **nack** (the pipeline
  already emitted the FAILURE audit; bronze remains the recoverable source, D5;
  the message stays live for Slice 11's quarantine path). Deterministic failures
  therefore redeliver until Slice 11 — the accepted, documented interim posture.
- the ONE ack-on-failure: an unparseable envelope (``EventContractError`` at
  parse). Identity may be unknowable there, so a D43-conformant audit row may be
  impossible, and a redelivery fails identically (the 9b precedent).

No ordering key is consumed: D60 resolved as STRIKE (canonical correctness is
event-time-based — D33 read-time dedup + the D64 conditional upsert; an ordering
key would defend nothing the consumer needs).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal

from dis_core.errors import DisError, EventContractError
from dis_core.logging import get_logger
from streaming_consumer.config import INGRESS_READY_SUBSCRIPTION, SERVICE_NAME
from streaming_consumer.envelope import parse_ingress_ready
from streaming_consumer.orchestrate import ConsumerPipeline

if TYPE_CHECKING:
    from google.cloud import pubsub_v1

_log = get_logger(SERVICE_NAME)

Decision = Literal["ack", "nack"]


async def process_message(pipeline: ConsumerPipeline, data: bytes) -> Decision:
    """Route one raw message body: parse, process, decide ack/nack."""
    try:
        event = parse_ingress_ready(data)
    except EventContractError as exc:
        _log.bind(stage="intake", tenant_id=exc.tenant_id, trace_id=exc.trace_id).error(
            "ingress.ready envelope rejected (terminal): %s", exc
        )
        return "ack"

    log = _log.bind(stage="intake", tenant_id=str(event.tenant_id), trace_id=str(event.trace_id))
    try:
        outcome = await pipeline.process(event)
    except Exception as exc:
        log.error("chunk failed (nacked; FAILURE audit emitted — audit-and-nack): %s", exc)
        return "nack"
    if outcome.disposition != "written":
        log.error("chunk failed validation: %s (nacked — audit-and-nack)", outcome.disposition)
        return "nack"
    log.info("processed: %s", outcome.disposition)
    return "ack"


@dataclass
class Subscriber:
    """The long-running pull loop over the consumer's ingress.ready subscription."""

    project_id: str
    pipeline: ConsumerPipeline
    max_messages: int = 10

    def __post_init__(self) -> None:
        import os

        if not os.environ.get("PUBSUB_EMULATOR_HOST"):
            raise DisError(
                "PUBSUB_EMULATOR_HOST is not set; refusing to subscribe to real Pub/Sub "
                "(cloud wiring is deferred infra)"
            )
        from google.cloud import pubsub_v1

        self._client = pubsub_v1.SubscriberClient()
        self._sub_path = self._client.subscription_path(self.project_id, INGRESS_READY_SUBSCRIPTION)
        self._require_subscription()

    def _require_subscription(self) -> None:
        """Fail loud at startup when the subscription is absent (errors, never skips)."""
        from google.api_core.exceptions import NotFound

        try:
            self._client.get_subscription(request={"subscription": self._sub_path})
        except NotFound as exc:
            raise DisError(
                f"subscription {INGRESS_READY_SUBSCRIPTION!r} does not exist on project "
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
            # Deadline 0 = immediate redelivery (the emulator honours it); D33
            # read-time dedup + the D64 conditional upsert absorb the replay.
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
