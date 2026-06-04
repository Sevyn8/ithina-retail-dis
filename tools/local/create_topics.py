"""Create the DIS Pub/Sub topics on the local emulator.

Idempotent: existing topics are skipped. Refuses to run against real GCP.
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

    return 0


if __name__ == "__main__":
    sys.exit(main())
