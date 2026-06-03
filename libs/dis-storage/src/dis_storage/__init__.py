"""dis-storage — the only sanctioned GCS access path in DIS (root CLAUDE.md hard rule 9).

- :func:`build_object_path` — the frozen canonical object-path scheme. The caller
  supplies ``trace_id``; the lib never mints it (hard rule 4).
- :class:`StorageClient` — a thin wrapper over ``google.cloud.storage.Client`` that
  honours ``STORAGE_EMULATOR_HOST`` (one place for GCS object read/write).
- :func:`generate_upload_url` — V4 signed PUT URL issuance. Deterministic and offline
  (signing needs a signer credential, not a network round-trip).

Issuance correctness offline is a *well-formed* URL, not proof that real GCS accepts
the signature; that is unverified until a real-GCS slice (first use: Slice 8's
15-minute signed PUT URL handler). Tests sign with a throwaway test credential only.
"""

from __future__ import annotations

from dis_storage.client import StorageClient
from dis_storage.paths import build_object_path
from dis_storage.signed_urls import generate_upload_url

__all__ = ["StorageClient", "build_object_path", "generate_upload_url"]
