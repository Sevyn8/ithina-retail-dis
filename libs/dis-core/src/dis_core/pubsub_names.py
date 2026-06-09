"""Resolve a Pub/Sub topic/subscription SHORT name from the environment.

Hard rule 10 still holds: the contract names are frozen. This resolver does NOT
change a name's meaning — it lets DEPLOYMENT override the literal short name a
publish/subscribe call passes, so the app conforms to whatever infra provisioned
(terraform's ``dis-`` prefixed, dots→dashes names) without the app and the infra
drifting apart. The default is the EXACT current local literal that
``tools/local/create_topics.py`` creates, so local dev — which sets no override —
is byte-for-byte unchanged.

The returned value is always a SHORT name (e.g. ``dis-csv-received``,
``dis-csv-received-sub``), never a full ``projects/.../topics/...`` path: every
call site passes it as the second arg to
``client.topic_path(project, name)`` / ``client.subscription_path(project, name)``,
which builds the full path itself.
"""

from __future__ import annotations

import os

from dis_core.errors import DisError


def resolve_pubsub_name(env_var: str, default: str) -> str:
    """Return the override in ``env_var`` if set, else ``default``.

    Set-but-empty RAISES ``DisError`` (code-quality rule 4 and the
    ``cors_allowed_origins_from_env`` precedent): an empty value is an ambiguous
    declaration, not a sanctioned fallback. Unset → the default. Terraform always
    sets a non-empty value; local sets nothing, so the empty branch is defensive.
    """
    raw = os.environ.get(env_var)
    if raw is None:
        return default
    name = raw.strip()
    if not name:
        raise DisError(
            f"{env_var} is set but empty; unset it for the default {default!r} or set the provisioned name"
        )
    return name
