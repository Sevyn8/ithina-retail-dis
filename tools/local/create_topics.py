"""Create the DIS Pub/Sub topics and worker subscriptions on the local emulator.

Idempotent: existing topics/subscriptions are skipped. Refuses to run against real
GCP. This is the ONE local provisioning place (Slice 9b): worker runtime code never
creates its own subscription — an absent subscription is a loud startup error in
the worker, not a silent auto-repair.
"""

import os
import sys

from google.api_core.exceptions import AlreadyExists
from google.cloud import pubsub_v1

TOPICS = [
    "csv.received",
    "ingress.ready",
    "ingress.resubmit",
    "identity.changed",
    "quarantine",
    "mapping.changed",
    "pipeline.dlq",
]

# subscription id -> topic. The csv-ingest-worker pulls csv.received from here
# (slice-9b) and the streaming consumer pulls ingress.ready (slice-10); each
# service's config pins its own name as a frozen constant.
SUBSCRIPTIONS = {
    "csv-ingest-worker.csv.received": "csv.received",
    "streaming-consumer.ingress.ready": "ingress.ready",
}


def main() -> int:
    if not os.getenv("PUBSUB_EMULATOR_HOST"):
        print("PUBSUB_EMULATOR_HOST not set; refusing to run against real Pub/Sub.", file=sys.stderr)
        return 2

    project = os.getenv("PUBSUB_PROJECT_ID", "local-dis")
    publisher = pubsub_v1.PublisherClient()

    for topic_name in TOPICS:
        topic_path = publisher.topic_path(project, topic_name)
        try:
            publisher.create_topic(request={"name": topic_path})
            print(f"created: {topic_name}")
        except AlreadyExists:
            print(f"exists:  {topic_name}")

    subscriber = pubsub_v1.SubscriberClient()
    for subscription_name, topic_name in SUBSCRIPTIONS.items():
        sub_path = subscriber.subscription_path(project, subscription_name)
        topic_path = publisher.topic_path(project, topic_name)
        try:
            subscriber.create_subscription(request={"name": sub_path, "topic": topic_path})
            print(f"created: {subscription_name} -> {topic_name}")
        except AlreadyExists:
            print(f"exists:  {subscription_name} -> {topic_name}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
