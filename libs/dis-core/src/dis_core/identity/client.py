"""Identity Service client interface and HTTP implementation.

``IdentityClient`` is the Protocol every consumer programs against. The Slice 2
fake and the Slice 13 real service both sit behind ``HttpIdentityClient`` —
"drop-in" means swapping the ``base_url`` (``IDENTITY_SERVICE_URL``), nothing in
caller code changes.

Errors are defined locally here (``IdentityClientError`` and subclasses) rather
than in a shared ``dis_core.errors`` module. That module is a Slice 3 deliverable;
Slice 3 should consolidate these local definitions into the real error hierarchy
(see the Slice 2 plan, D-B split / §9). Keeping them here avoids pre-building a
half-finished ``errors.py`` that Slice 3 would have to reconcile.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

import httpx

from dis_core.identity.models import (
    Error,
    Identity,
    ResolveFromEndpointRequest,
    ResolveFromTokenRequest,
    ResolveFromUploadRequest,
    ValidateRequest,
    ValidateResponse,
)


class IdentityClientError(Exception):
    """Base error for Identity Service client calls.

    Carries the contract's ``Error`` envelope fields when the server returned one,
    plus the HTTP status code for callers that branch on transport-level outcome.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        error_code: str | None = None,
        trace_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.trace_id = trace_id


class IdentityNotFoundError(IdentityClientError):
    """The token / upload session / endpoint config did not map to a tenant+store.

    Maps to HTTP 404 / ``error_code == "identity_not_found"``. Hard failure: callers
    should not retry.
    """


class IdentityServiceUnavailableError(IdentityClientError):
    """Customer Master unhealthy and stale window exceeded (HTTP 503 / circuit_open).

    Resolve callers retry with backoff; validate callers fall back to identity_mirror.
    """

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        error_code: str | None = None,
        trace_id: str | None = None,
        retry_after: int | None = None,
    ) -> None:
        super().__init__(
            message,
            status_code=status_code,
            error_code=error_code,
            trace_id=trace_id,
        )
        self.retry_after = retry_after


@runtime_checkable
class IdentityClient(Protocol):
    """The four Identity Service methods (architecture §4.2 / OpenAPI v1).

    Async because every DIS consumer (receivers, streaming-consumer, dis-ui-server)
    is async FastAPI. The real Slice 13 service is reached the same way.
    """

    async def resolve_from_token(self, jwt: str) -> Identity: ...

    async def resolve_from_upload(self, upload_session_id: str) -> Identity: ...

    async def resolve_from_endpoint(self, endpoint_config_id: str) -> Identity: ...

    async def validate(self, tenant_id: str, store_id: str) -> ValidateResponse: ...


class HttpIdentityClient:
    """HTTP implementation of :class:`IdentityClient` (talks the OpenAPI contract).

    Works against any server honoring the contract — the Slice 2 fake or the real
    Slice 13 service. Pass ``base_url`` from ``IDENTITY_SERVICE_URL``. An
    ``httpx.AsyncClient`` may be injected (e.g. an ASGI transport pointing at the
    in-process fake) for tests; otherwise one is created and owned by this client.
    """

    def __init__(
        self,
        base_url: str,
        *,
        service_token: str | None = None,
        timeout: float = 5.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._service_token = service_token
        self._owns_client = client is None
        headers = {"Authorization": f"Bearer {service_token}"} if service_token else {}
        self._client = client or httpx.AsyncClient(base_url=self._base_url, timeout=timeout, headers=headers)

    async def __aenter__(self) -> HttpIdentityClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    # -- the four methods ----------------------------------------------------

    async def resolve_from_token(self, jwt: str) -> Identity:
        body = await self._post("/v1/resolve_from_token", ResolveFromTokenRequest(jwt=jwt))
        return Identity.model_validate(body)

    async def resolve_from_upload(self, upload_session_id: str) -> Identity:
        body = await self._post(
            "/v1/resolve_from_upload",
            ResolveFromUploadRequest(upload_session_id=upload_session_id),
        )
        return Identity.model_validate(body)

    async def resolve_from_endpoint(self, endpoint_config_id: str) -> Identity:
        body = await self._post(
            "/v1/resolve_from_endpoint",
            ResolveFromEndpointRequest(endpoint_config_id=endpoint_config_id),
        )
        return Identity.model_validate(body)

    async def validate(self, tenant_id: str, store_id: str) -> ValidateResponse:
        body = await self._post("/v1/validate", ValidateRequest(tenant_id=tenant_id, store_id=store_id))
        return ValidateResponse.model_validate(body)

    # -- transport -----------------------------------------------------------

    async def _post(self, path: str, payload: object) -> object:
        # Both construction paths (injected client and self-created client) set
        # base_url, so posting the relative path joins correctly in either case.
        response = await self._client.post(path, json=_dump(payload))
        if response.is_success:
            return response.json()
        raise self._to_error(response)

    def _to_error(self, response: httpx.Response) -> IdentityClientError:
        error_code: str | None = None
        message = f"Identity Service returned HTTP {response.status_code}"
        trace_id: str | None = None
        try:
            err = Error.model_validate(response.json())
            error_code, message, trace_id = err.error_code, err.message, err.trace_id
        except (ValueError, httpx.DecodingError):
            pass  # non-JSON / non-conforming body; fall back to the generic message

        if response.status_code == 404 or error_code == "identity_not_found":
            return IdentityNotFoundError(
                message, status_code=response.status_code, error_code=error_code, trace_id=trace_id
            )
        if response.status_code == 503 or error_code == "circuit_open":
            retry_after = response.headers.get("Retry-After")
            return IdentityServiceUnavailableError(
                message,
                status_code=response.status_code,
                error_code=error_code,
                trace_id=trace_id,
                retry_after=int(retry_after) if retry_after and retry_after.isdigit() else None,
            )
        return IdentityClientError(
            message, status_code=response.status_code, error_code=error_code, trace_id=trace_id
        )


def _dump(payload: object) -> dict[str, object]:
    # NOTE (flag for Slice 3 / whoever extends the request models): model_dump()
    # without mode="json" is safe today because every request field is a plain str.
    # If a request model later gains a UUID / datetime / enum field, switch to
    # model_dump(mode="json") or the httpx json= encode will fail on the raw object.
    if hasattr(payload, "model_dump"):
        return payload.model_dump()  # type: ignore[no-any-return]
    raise TypeError(f"unexpected payload type: {type(payload)!r}")
