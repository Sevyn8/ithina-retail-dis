-- ============================================================================
-- DIS audit schema: events
--
-- End-to-end audit trail of every ingress event flowing through the DIS
-- pipeline. Emitted by every DIS service at each pipeline stage. Joins all
-- telemetry for a given trace_id across services.
--
-- Cloud SQL is the Phase 1 home for audit events. BigQuery archival of this
-- table is the Phase 3 deliverable (see build-guide.md Slice 16); the BQ
-- schema lives at schemas/bigquery/audit_events.sql and mirrors this one.
--
-- Written by:
--   - services/csv-ingest-worker, receiver-api, receiver-csv-erp,
--     receiver-reverse-api (RECEIVED, PII_TOKENIZED, BRONZE_WRITTEN,
--     INGRESS_PUBLISHED).
--   - services/streaming-consumer (MAPPING_LOOKED_UP, IDENTITY_VALIDATED,
--     PRE_MAPPING_VALIDATED, MAPPING_EXECUTED, POST_MAPPING_VALIDATED,
--     CANONICAL_WRITTEN, QUARANTINED).
--   - services/daily-compute (SIGNAL_COMPUTED).
--   - services/quarantine-drainer, dis-ui-server, mirror-sync-consumer.
--   - services/nightly-batch (BQ_EXPORTED, PARTITION_DROPPED) — Phase 3.
--
-- Read by:
--   - services/dis-ui-server audit handler (tenant-facing trace lookup).
--   - DIS engineering for ops investigations.
--
-- ----------------------------------------------------------------------------
-- RLS: enabled and forced
-- ----------------------------------------------------------------------------
-- This table contains tenant-identifiable data. Tenant operators viewing
-- their own audit trail must not see other tenants'. Emitters SET LOCAL
-- app.tenant_id per event; dis-ui-server SET LOCAL for tenant queries.
--
-- ----------------------------------------------------------------------------
-- Audit volume model (Option B)
-- ----------------------------------------------------------------------------
-- Two scopes of audit events:
--   INGRESS_EVENT-scoped: one row per stage per chunk. Records stage outcome
--                         at the chunk level (row counts, duration).
--   ROW-scoped:           one row per failed row at per-row stages.
--                         Records row-level failure detail.
--
-- For each ingress event (one CSV upload = one chunk = one bronze row):
--   - 6 INGRESS_EVENT-scoped events at chunk-level stages.
--   - 4 INGRESS_EVENT-scoped events at per-row stages (stage summaries).
--   - F ROW-scoped events where F is the row-failure count.
-- Total: 10 + F events per ingress event.
--
-- Volume scales with failure rate, not row count.
--
-- ----------------------------------------------------------------------------
-- Phase 0 migration order
-- ----------------------------------------------------------------------------
--
-- 1. Schemas exist: audit, identity_mirror.
-- 2. uuidv7() function installed.
-- 3. identity_mirror.tenants and identity_mirror.stores exist.
-- 4. Apply this DDL.
--
-- ----------------------------------------------------------------------------
-- Dependencies
-- ----------------------------------------------------------------------------
--   - schema: audit
--   - schema: identity_mirror, with tables tenants, stores
--   - function: uuidv7()
-- ============================================================================


CREATE TABLE audit.events (

    -- ---------- Surrogate key ----------
    id                          UUID                                NOT NULL DEFAULT uuidv7(),

    -- ---------- Time ----------
    event_timestamp             TIMESTAMPTZ                         NOT NULL,
    event_date                  DATE                                NOT NULL,

    -- ---------- Correlation ----------
    trace_id                    UUID                                NOT NULL,

    -- ---------- Identity ----------
    tenant_id                   UUID                                NULL,
        -- NULL for system-level events that precede tenant identification
        -- (e.g., pre-auth receiver errors).
    data_ingress_event_id       UUID                                NULL,
        -- Reference to bronze.data_ingress_events.id. NULL for events outside
        -- the ingress lifecycle (e.g., scheduled jobs).

    -- ---------- Stage identification ----------
    service_name                VARCHAR(64)  COLLATE "C"            NOT NULL,
    service_version             VARCHAR(64)  COLLATE "C"            NULL,
    stage                       VARCHAR(64)  COLLATE "C"            NOT NULL,

    -- ---------- Scope distinguisher ----------
    event_scope                 VARCHAR(32)  COLLATE "C"            NOT NULL,
        -- INGRESS_EVENT or ROW.

    -- ---------- Outcome ----------
    outcome                     VARCHAR(32)  COLLATE "C"            NOT NULL,
        -- SUCCESS, FAILURE, SKIPPED, RETRIED.

    -- ---------- Per-event metrics ----------
    row_count                   INTEGER                             NULL,
    rows_succeeded              INTEGER                             NULL,
    rows_failed                 INTEGER                             NULL,
    duration_ms                 INTEGER                             NULL,

    -- ---------- Row-level addressing (ROW scope only) ----------
    row_offset                  INTEGER                             NULL,

    -- ---------- Mapping context ----------
    mapping_version_id          BIGINT                              NULL,

    -- ---------- Failure detail ----------
    failure_code                VARCHAR(64)  COLLATE "C"            NULL,
    failure_message             VARCHAR(2048)                       NULL,

    -- ---------- Stage-specific structured context ----------
    event_data                  JSONB                               NULL,

    -- ---------- Caller context (receiver stages only) ----------
    auth_principal              VARCHAR(256) COLLATE "C"            NULL,
    client_ip                   INET                                NULL,

    -- ---------- DIS-managed ----------
    _loaded_at                  TIMESTAMPTZ                         NOT NULL DEFAULT NOW(),
        -- When the emitter wrote this row. Distinct from event_timestamp
        -- (when the stage event occurred). For emission-latency monitoring.

    -- ---------- Primary key ----------
    CONSTRAINT pk_audit_events
        PRIMARY KEY (id),

    -- ---------- Foreign keys ----------
    CONSTRAINT fk_audit_events_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES identity_mirror.tenants (tenant_id)
        ON DELETE RESTRICT,

    -- ---------- Check constraints ----------
    CONSTRAINT ck_audit_events_event_scope_vocab
        CHECK (event_scope IN ('INGRESS_EVENT', 'ROW')),

    CONSTRAINT ck_audit_events_outcome_vocab
        CHECK (outcome IN ('SUCCESS', 'FAILURE', 'SKIPPED', 'RETRIED')),

    CONSTRAINT ck_audit_events_row_count_non_negative
        CHECK (row_count IS NULL OR row_count >= 0),

    CONSTRAINT ck_audit_events_rows_succeeded_non_negative
        CHECK (rows_succeeded IS NULL OR rows_succeeded >= 0),

    CONSTRAINT ck_audit_events_rows_failed_non_negative
        CHECK (rows_failed IS NULL OR rows_failed >= 0),

    CONSTRAINT ck_audit_events_duration_non_negative
        CHECK (duration_ms IS NULL OR duration_ms >= 0),

    CONSTRAINT ck_audit_events_event_date_matches
        CHECK (event_date = (event_timestamp AT TIME ZONE 'UTC')::DATE)
);


-- ----------------------------------------------------------------------------
-- Partitioning
-- ----------------------------------------------------------------------------
-- audit.events grows linearly with pipeline traffic. Partition by event_date
-- to keep query plans tight and enable retention-based partition drop in
-- Phase 3 (after BQ archival).
--
-- Phase 1 retention: 35 days in Cloud SQL (matches canonical event-table
-- retention; see decisions.md D29). Phase 3: nightly-batch archives older
-- partitions to BigQuery before dropping.
-- ----------------------------------------------------------------------------

-- Partitioning to be added in the Alembic migration (PARTITION BY RANGE
-- (event_date)). Initial migration creates the parent table and the first
-- N daily partitions; subsequent partitions are created by a Cloud Scheduler
-- job (Phase 1) or a daily-compute side task.


-- ----------------------------------------------------------------------------
-- Indexes (beyond PK)
-- ----------------------------------------------------------------------------

-- Primary lookup path: trace_id (single ingress event's full audit trail).
CREATE INDEX ix_audit_events_trace_id
    ON audit.events (trace_id);

-- Tenant-scoped time-range queries from dis-ui-server.
CREATE INDEX ix_audit_events_tenant_time
    ON audit.events (tenant_id, event_timestamp DESC)
    WHERE tenant_id IS NOT NULL;

-- Stage-level dashboards: count events by service/stage over time.
CREATE INDEX ix_audit_events_service_stage_time
    ON audit.events (service_name, stage, event_timestamp DESC);

-- data_ingress_event_id lookup (link to bronze).
CREATE INDEX ix_audit_events_data_ingress_event
    ON audit.events (data_ingress_event_id)
    WHERE data_ingress_event_id IS NOT NULL;

-- Failure forensics: every FAILURE event by tenant + time.
CREATE INDEX ix_audit_events_failures
    ON audit.events (tenant_id, event_timestamp DESC)
    WHERE outcome = 'FAILURE';


-- ----------------------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------------------
-- Force RLS on every read. tenant_id IS NULL events are visible only to
-- service-level / ops queries that explicitly set app.tenant_id to NULL.

ALTER TABLE audit.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.events FORCE ROW LEVEL SECURITY;

CREATE POLICY rls_audit_events_tenant
    ON audit.events
    USING (
        tenant_id = current_setting('app.tenant_id', true)::UUID
        OR tenant_id IS NULL
    );


-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------

COMMENT ON TABLE audit.events IS
'End-to-end audit trail of every ingress event flowing through the DIS pipeline. Phase 1 home (Cloud SQL); Phase 3 archives to BigQuery audit_events. Emitted fire-and-forget by every service at each pipeline stage. Volume scales with failure rate, not row count.';

COMMENT ON COLUMN audit.events.id IS
'UUIDv7 generated by the emitting service. Audit event identifier.';

COMMENT ON COLUMN audit.events.trace_id IS
'End-to-end trace identifier propagated from the receiver. Joins all audit events for one ingress event lifecycle.';

COMMENT ON COLUMN audit.events.tenant_id IS
'Tenant this event pertains to. NULL for system-level events that precede tenant identification (e.g., pre-auth receiver errors).';

COMMENT ON COLUMN audit.events.event_scope IS
'INGRESS_EVENT (per-stage summary for one chunk) or ROW (per-row record, typically failures). See Option B audit model in table header.';

COMMENT ON COLUMN audit.events.event_data IS
'Stage-specific structured context. Shape per (service_name, stage) documented in each service. Examples: BRONZE_WRITTEN = {gcs_uri, payload_size_bytes, payload_sha256}; CANONICAL_WRITTEN = {written_to_table, row_id}; PRE_MAPPING_VALIDATED (ROW failure) = {column, expected_type, actual_value, pandera_error}.';

COMMENT ON COLUMN audit.events._loaded_at IS
'When the emitter wrote this row. Distinct from event_timestamp (when the stage event occurred). For emission-latency monitoring.';
