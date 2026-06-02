-- ============================================================================
-- DIS config schema: source_mappings
--
-- Versioned mapping configurations per (tenant, source). The contract between
-- an external data source and DIS canonical. Read by the streaming consumer
-- as a refreshing side input; new versions trigger refresh via the
-- mapping.changed Pub/Sub event.
--
-- Every row is immutable once written. Edits create a new version row,
-- leaving the prior version intact. This is the load-bearing property for
-- B1 (architecture v0.6): canonical rows pin to the mapping_version_id that
-- produced them, and replay defaults to that pinned version.
--
-- ----------------------------------------------------------------------------
-- Status lifecycle
-- ----------------------------------------------------------------------------
--   DRAFT      : created by onboarding service, not yet promoted.
--                Pipeline ignores.
--   STAGED     : ready for shadow rollout. Pipeline reads it for shadow mode;
--                canonical writes go to staging.* schema, not canonical.*.
--   ACTIVE     : in production. Pipeline reads this for new canonical writes.
--                At most one ACTIVE per (tenant, source) at a time.
--   DEPRECATED : superseded. Pipeline doesn't use for new writes; kept for
--                replay of historical chunks.
--
-- ----------------------------------------------------------------------------
-- Label generation
-- ----------------------------------------------------------------------------
-- Human-readable mapping labels are generated, not stored. The view
-- config.source_mappings_v exposes a computed `label` column with the
-- pattern: {first_word_of_tenant_name}-{source_id}-v{seq}-{YYYYMMDD}.
-- Example: acme-shopify_pos_v2-v3-20260528.
--
-- ----------------------------------------------------------------------------
-- RLS: not enabled
-- ----------------------------------------------------------------------------
-- The streaming consumer reads mappings across all tenants at startup and on
-- mapping.changed refresh. RLS would force per-tenant context switching on
-- every read. This table holds configuration, not tenant data; isolation is
-- enforced downstream when canonical writes happen.
--
-- ----------------------------------------------------------------------------
-- Phase 0 migration order
-- ----------------------------------------------------------------------------
--
-- 1. Schemas exist: config, identity_mirror.
-- 2. uuidv7() function installed.
-- 3. identity_mirror.tenants exists.
-- 4. Apply this DDL.
--
-- ----------------------------------------------------------------------------
-- Dependencies
-- ----------------------------------------------------------------------------
--   - schema: config
--   - schema: identity_mirror, with table tenants
--   - function: uuidv7()
-- ============================================================================


CREATE TABLE config.source_mappings (

    -- ---------- Surrogate key ----------
    mapping_version_id              BIGSERIAL                       NOT NULL,
        -- Monotonic across all tenants and sources. FK target for canonical
        -- mapping_version_id. Sequential numbers are easier to read in audit
        -- logs than UUIDs.

    -- ---------- Identity ----------
    tenant_id                       UUID                            NOT NULL,
    source_id                       VARCHAR(128) COLLATE "C"        NOT NULL,
        -- The registered source this mapping is for (e.g., 'shopify_pos_v2',
        -- 'square_csv', 'manual_csv_upload').
    version_seq_per_source          SMALLINT                        NOT NULL,
        -- Per-(tenant, source) sequence number. Set by trigger on INSERT.
        -- Resets per (tenant, source).

    -- ---------- Status ----------
    status                          TEXT COLLATE "C"                NOT NULL,
        -- DRAFT, STAGED, ACTIVE, DEPRECATED. See file header for semantics.

    -- ---------- Mapping payload ----------
    mapping_rules                   JSONB                           NOT NULL,
        -- The rename + normalize + cast + derive rules per source field.
        -- Shape is source-type dependent; documented per source type in
        -- libs/dis-mapping; validated by Pandera at streaming consumer load.

    pre_validation_suite_ref        VARCHAR(256) COLLATE "C"        NULL,
        -- Reference to the Pandera source-shape suite (module:ClassName).
        -- NULL means use default per source_id.
    post_validation_suite_ref       VARCHAR(256) COLLATE "C"        NULL,
        -- Reference to the Pandera canonical-shape suite. NULL means use
        -- default per target canonical table.

    -- ---------- Lineage ----------
    predecessor_version_id          BIGINT                          NULL,
        -- The mapping_version_id this version was edited from. NULL for the
        -- first version of a (tenant, source). Not a FK to itself: kept as
        -- informational for ops; no enforcement value.

    -- ---------- Lifecycle timestamps ----------
    activated_at                    TIMESTAMPTZ                     NULL,
        -- When this version transitioned to ACTIVE.
    deprecated_at                   TIMESTAMPTZ                     NULL,
        -- When this version transitioned to DEPRECATED.

    -- ---------- Authorship ----------
    created_by_user_id              UUID                            NULL,
        -- Customer Master user who created/promoted this version. Not a FK
        -- (cross-DB). NULL if produced by an automated path (e.g., default
        -- mapping seeded by onboarding service).

    -- ---------- DIS-managed ----------
    created_at                      TIMESTAMPTZ                     NOT NULL DEFAULT NOW(),
    metadata                        JSONB                           NULL,
        -- Free-form notes: change description, onboarding context, ops notes.
        -- Designed to evolve.

    -- ---------- Primary key ----------
    CONSTRAINT pk_csm
        PRIMARY KEY (mapping_version_id),

    -- ---------- Per-(tenant, source) sequence uniqueness ----------
    CONSTRAINT uq_csm_seq_per_source
        UNIQUE (tenant_id, source_id, version_seq_per_source),

    -- ---------- Foreign key ----------
    CONSTRAINT fk_csm_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES identity_mirror.tenants (tenant_id),

    -- ---------- Check constraints ----------
    CONSTRAINT ck_csm_status_vocab
        CHECK (status IN ('DRAFT', 'STAGED', 'ACTIVE', 'DEPRECATED')),

    CONSTRAINT ck_csm_version_seq_positive
        CHECK (version_seq_per_source > 0),

    CONSTRAINT ck_csm_activated_consistency
        CHECK (
            (status NOT IN ('ACTIVE', 'DEPRECATED') AND activated_at IS NULL)
            OR
            (status IN ('ACTIVE', 'DEPRECATED') AND activated_at IS NOT NULL)
        ),

    CONSTRAINT ck_csm_deprecated_consistency
        CHECK (
            (status != 'DEPRECATED' AND deprecated_at IS NULL)
            OR
            (status = 'DEPRECATED' AND deprecated_at IS NOT NULL)
        )
);


-- ----------------------------------------------------------------------------
-- At most one ACTIVE mapping per (tenant, source)
-- ----------------------------------------------------------------------------

CREATE UNIQUE INDEX uq_csm_active_per_source
    ON config.source_mappings (tenant_id, source_id)
    WHERE status = 'ACTIVE';


-- ----------------------------------------------------------------------------
-- Other indexes
-- ----------------------------------------------------------------------------

-- Streaming consumer's startup read: "find active mappings for this tenant".
-- Pipeline reads per-(tenant, source) active mapping; the partial unique
-- above is the primary lookup. This wider index supports filtering ops queries.
CREATE INDEX ix_csm_tenant_source_status
    ON config.source_mappings (tenant_id, source_id, status);

-- Ops: "show me all DRAFT mappings", "all DEPRECATED mappings".
CREATE INDEX ix_csm_status
    ON config.source_mappings (status);

-- Lineage navigation.
CREATE INDEX ix_csm_predecessor
    ON config.source_mappings (predecessor_version_id)
    WHERE predecessor_version_id IS NOT NULL;


-- ----------------------------------------------------------------------------
-- Trigger: auto-set version_seq_per_source on INSERT
--
-- Computes MAX(version_seq_per_source) + 1 for the (tenant_id, source_id)
-- pair. Concurrent INSERTs for the same (tenant, source) serialize on the
-- uq_csm_seq_per_source unique constraint; one wins, the others retry.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION config.set_csm_version_seq()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.version_seq_per_source IS NULL OR NEW.version_seq_per_source = 0 THEN
        SELECT COALESCE(MAX(version_seq_per_source), 0) + 1
        INTO NEW.version_seq_per_source
        FROM config.source_mappings
        WHERE tenant_id = NEW.tenant_id
          AND source_id = NEW.source_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_csm_set_version_seq
    BEFORE INSERT ON config.source_mappings
    FOR EACH ROW
    EXECUTE FUNCTION config.set_csm_version_seq();


-- ----------------------------------------------------------------------------
-- View: human-readable label
--
-- Computes the mapping label from tenant name + source + sequence + date.
-- Pattern: {first_word_of_tenant_name}-{source_id}-v{seq}-{YYYYMMDD}.
-- ----------------------------------------------------------------------------

CREATE VIEW config.source_mappings_v AS
SELECT
    sm.mapping_version_id,
    sm.tenant_id,
    sm.source_id,
    sm.version_seq_per_source,
    sm.status,
    sm.mapping_rules,
    sm.pre_validation_suite_ref,
    sm.post_validation_suite_ref,
    sm.predecessor_version_id,
    sm.activated_at,
    sm.deprecated_at,
    sm.created_by_user_id,
    sm.created_at,
    sm.metadata,
    -- Generated label:
    LOWER(REGEXP_REPLACE(SPLIT_PART(t.name, ' ', 1), '[^a-zA-Z0-9]', '', 'g'))
        || '-' || sm.source_id
        || '-v' || sm.version_seq_per_source
        || '-' || TO_CHAR(sm.created_at, 'YYYYMMDD')
        AS label
FROM config.source_mappings sm
JOIN identity_mirror.tenants t
    ON t.tenant_id = sm.tenant_id;


-- ----------------------------------------------------------------------------
-- Comments
-- ----------------------------------------------------------------------------

COMMENT ON TABLE config.source_mappings IS
'Versioned mapping configurations per (tenant, source). Immutable once written; edits create new versions. The FK target for canonical.*.mapping_version_id (B1 architecture v0.6). Read by the streaming consumer as a refreshing side input; new versions trigger refresh via mapping.changed Pub/Sub event.';

COMMENT ON COLUMN config.source_mappings.mapping_version_id IS
'Monotonic surrogate identifier across all tenants and sources. BIGSERIAL. FK target for canonical mapping_version_id.';

COMMENT ON COLUMN config.source_mappings.tenant_id IS
'The tenant this mapping belongs to. FK to identity_mirror.tenants(tenant_id).';

COMMENT ON COLUMN config.source_mappings.source_id IS
'The registered source this mapping is for (e.g., shopify_pos_v2, square_csv, manual_csv_upload). COLLATE "C".';

COMMENT ON COLUMN config.source_mappings.version_seq_per_source IS
'Per-(tenant, source) sequence number, starting at 1. Set automatically by the trg_csm_set_version_seq trigger on INSERT if NULL or 0 is supplied. Forms part of the generated label.';

COMMENT ON COLUMN config.source_mappings.status IS
'Lifecycle status. DRAFT: not promoted. STAGED: shadow rollout (writes go to staging.*). ACTIVE: in production. DEPRECATED: superseded, retained for replay. At most one ACTIVE per (tenant, source) enforced by uq_csm_active_per_source.';

COMMENT ON COLUMN config.source_mappings.mapping_rules IS
'The rename + normalize + cast + derive rules per source field. JSONB; shape is source-type dependent; documented in libs/dis-mapping; validated by Pandera when the streaming consumer loads it.';

COMMENT ON COLUMN config.source_mappings.pre_validation_suite_ref IS
'Reference to the Pandera source-shape suite (module:ClassName). NULL means use default per source_id.';

COMMENT ON COLUMN config.source_mappings.post_validation_suite_ref IS
'Reference to the Pandera canonical-shape suite. NULL means use default per target canonical table.';

COMMENT ON COLUMN config.source_mappings.predecessor_version_id IS
'The mapping_version_id this version was edited from. NULL for the first version of a (tenant, source). Informational only (not a FK).';

COMMENT ON COLUMN config.source_mappings.activated_at IS
'When this version transitioned to ACTIVE. NULL for DRAFT and STAGED rows. NOT NULL for ACTIVE and DEPRECATED rows (CHECK enforced).';

COMMENT ON COLUMN config.source_mappings.deprecated_at IS
'When this version transitioned to DEPRECATED. NULL for all other statuses. NOT NULL only for DEPRECATED rows (CHECK enforced).';

COMMENT ON COLUMN config.source_mappings.created_by_user_id IS
'Customer Master user who created/promoted this version. Not a FK (cross-DB). NULL if produced by an automated path.';

COMMENT ON COLUMN config.source_mappings.created_at IS
'When DIS wrote this row. DEFAULT NOW() on INSERT. Used in label generation.';

COMMENT ON COLUMN config.source_mappings.metadata IS
'Free-form JSONB notes: change description, onboarding context, ops notes. Designed to evolve.';

COMMENT ON VIEW config.source_mappings_v IS
'View of source_mappings with a generated human-readable label column. Label pattern: {first_word_of_tenant_name}-{source_id}-v{seq}-{YYYYMMDD}. Tenant name fetched from identity_mirror.tenants.';
