-- VDT SQLite schema (development/test). SQL Server DDL is a separate,
-- manually reviewed package (see docs/architecture/vdt-database-design.md).
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS ref_region (
    region_id TEXT PRIMARY KEY,
    region_code TEXT NOT NULL UNIQUE,
    region_name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ref_revision_cycle (
    revision_cycle_id INTEGER PRIMARY KEY,
    cycle_year INTEGER NOT NULL UNIQUE,
    cycle_code TEXT NOT NULL UNIQUE,
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS ref_unit (
    unit_id TEXT PRIMARY KEY,
    unit_code TEXT NOT NULL UNIQUE,
    symbol TEXT NOT NULL,
    quantity_dimension TEXT,
    scale_factor TEXT NOT NULL DEFAULT '1',
    display_decimals INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ref_reporting_period (
    period_id INTEGER PRIMARY KEY,
    period_code TEXT NOT NULL UNIQUE,
    granularity TEXT NOT NULL CHECK (granularity IN ('YEAR', 'MONTH')),
    calendar_year INTEGER NOT NULL,
    calendar_month INTEGER,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vdt_dataset (
    dataset_id TEXT PRIMARY KEY,
    dataset_type TEXT NOT NULL CHECK (dataset_type IN ('REGION', 'GLOBAL')),
    region_id TEXT REFERENCES ref_region(region_id),
    dataset_code TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_vdt_dataset_region
    ON vdt_dataset(dataset_type, region_id);

CREATE TABLE IF NOT EXISTS vdt_dataset_cycle (
    dataset_cycle_id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL REFERENCES vdt_dataset(dataset_id),
    revision_cycle_id INTEGER NOT NULL REFERENCES ref_revision_cycle(revision_cycle_id),
    template_version TEXT NOT NULL,
    publication_id TEXT NOT NULL,
    published_at TEXT NOT NULL,
    UNIQUE (dataset_id, revision_cycle_id)
);

CREATE TABLE IF NOT EXISTS vdt_global_region_reference (
    global_region_reference_id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL REFERENCES vdt_dataset(dataset_id),
    region_code TEXT NOT NULL,
    region_name_original TEXT,
    UNIQUE (dataset_id, region_code)
);

CREATE TABLE IF NOT EXISTS vdt_tree (
    tree_id TEXT PRIMARY KEY,
    dataset_cycle_id TEXT NOT NULL REFERENCES vdt_dataset_cycle(dataset_cycle_id),
    tree_code TEXT NOT NULL,
    tree_name_original TEXT NOT NULL,
    tree_type TEXT NOT NULL CHECK (tree_type IN ('GENERAL_FCF', 'REGIONAL_FCF', 'PRODUCTION', 'COST')),
    source_worksheet TEXT NOT NULL,
    UNIQUE (dataset_cycle_id, tree_code),
    UNIQUE (dataset_cycle_id, source_worksheet)
);

CREATE TABLE IF NOT EXISTS vdt_tree_pair (
    tree_pair_id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL REFERENCES vdt_dataset(dataset_id),
    pair_code TEXT NOT NULL,
    pair_name_original TEXT,
    production_tree_id TEXT NOT NULL REFERENCES vdt_tree(tree_id),
    cost_tree_id TEXT NOT NULL REFERENCES vdt_tree(tree_id),
    UNIQUE (dataset_id, pair_code)
);

CREATE TABLE IF NOT EXISTS vdt_tree_structure (
    tree_structure_id TEXT PRIMARY KEY,
    tree_id TEXT NOT NULL REFERENCES vdt_tree(tree_id),
    structure_code TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vdt_tree_node (
    node_id TEXT PRIMARY KEY,
    tree_structure_id TEXT NOT NULL REFERENCES vdt_tree_structure(tree_structure_id),
    node_code TEXT NOT NULL,
    parent_node_id TEXT REFERENCES vdt_tree_node(node_id),
    display_order INTEGER NOT NULL CHECK (display_order > 0),
    kpi_name_original TEXT NOT NULL,
    description_original TEXT,
    unit_id TEXT REFERENCES ref_unit(unit_id),
    unit_original TEXT,
    node_type TEXT NOT NULL CHECK (node_type IN ('GROUP', 'INPUT', 'CALCULATED')),
    favorable_direction TEXT CHECK (favorable_direction IN ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER', 'NEUTRAL')),
    missing_policy TEXT NOT NULL DEFAULT 'ALLOW' CHECK (missing_policy IN ('BLOCK', 'WARN', 'ALLOW')),
    source_row INTEGER,
    UNIQUE (tree_structure_id, node_code),
    UNIQUE (tree_structure_id, parent_node_id, display_order)
);
-- Note: one or more roots (parent_node_id IS NULL) per tree_structure_id are
-- permitted; there is no single-root constraint.

CREATE TABLE IF NOT EXISTS vdt_node_formula (
    formula_id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES vdt_tree_node(node_id),
    expression TEXT NOT NULL,
    formula_language_version TEXT NOT NULL,
    expression_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS vdt_node_dependency (
    dependency_id TEXT PRIMARY KEY,
    formula_id TEXT NOT NULL REFERENCES vdt_node_formula(formula_id),
    result_node_id TEXT NOT NULL REFERENCES vdt_tree_node(node_id),
    source_node_id TEXT REFERENCES vdt_tree_node(node_id),
    reference_scope TEXT NOT NULL CHECK (reference_scope IN ('SAME_TREE', 'SAME_REGION', 'REGIONAL_FCF')),
    source_region_code TEXT,
    source_tree_code TEXT,
    source_node_code TEXT NOT NULL,
    resolution_status TEXT NOT NULL CHECK (resolution_status IN ('RESOLVED', 'MISSING_DEPENDENCY'))
);

CREATE INDEX IF NOT EXISTS ix_node_dependency_source ON vdt_node_dependency(source_node_id);
CREATE INDEX IF NOT EXISTS ix_node_dependency_result ON vdt_node_dependency(result_node_id);

CREATE TABLE IF NOT EXISTS vdt_node_value (
    node_value_id TEXT PRIMARY KEY,
    dataset_cycle_id TEXT NOT NULL REFERENCES vdt_dataset_cycle(dataset_cycle_id),
    node_id TEXT NOT NULL REFERENCES vdt_tree_node(node_id),
    value_context TEXT NOT NULL CHECK (value_context IN ('ACTUALS', 'BUDGET', 'LOBP', 'BENCHMARK')),
    period_id INTEGER NOT NULL REFERENCES ref_reporting_period(period_id),
    value TEXT,
    value_status TEXT NOT NULL CHECK (
        value_status IN ('AVAILABLE', 'MISSING', 'MISSING_DEPENDENCY', 'NOT_INFORMED', 'CALCULATION_ERROR')
    ),
    value_origin TEXT NOT NULL CHECK (value_origin IN ('INPUT', 'CALCULATED')),
    formula_id TEXT REFERENCES vdt_node_formula(formula_id),
    calculated_at TEXT,
    UNIQUE (dataset_cycle_id, node_id, value_context, period_id)
);

CREATE TABLE IF NOT EXISTS vdt_calculation_issue (
    calculation_issue_id TEXT PRIMARY KEY,
    node_value_id TEXT NOT NULL REFERENCES vdt_node_value(node_value_id),
    issue_code TEXT NOT NULL,
    dependency_id TEXT REFERENCES vdt_node_dependency(dependency_id),
    message TEXT,
    details_json TEXT
);

CREATE TABLE IF NOT EXISTS audit_import_batch (
    import_batch_id TEXT PRIMARY KEY,
    dataset_type TEXT NOT NULL,
    region_id TEXT,
    revision_cycle_id INTEGER,
    file_name TEXT NOT NULL,
    file_uri TEXT NOT NULL,
    file_sha256 TEXT NOT NULL,
    template_version TEXT,
    status TEXT NOT NULL,
    initiated_by TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    error_count INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    source_row_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_user_session (
    user_session_id TEXT PRIMARY KEY,
    user_subject TEXT NOT NULL,
    preferred_username TEXT,
    email TEXT,
    started_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    ended_at TEXT,
    application_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_application_event (
    application_event_id TEXT PRIMARY KEY,
    user_session_id TEXT NOT NULL REFERENCES audit_user_session(user_session_id),
    user_subject TEXT NOT NULL,
    event_name TEXT NOT NULL,
    screen_code TEXT,
    route_template TEXT,
    dataset_type TEXT,
    region_code TEXT,
    tree_code TEXT,
    revision_cycle_id INTEGER,
    request_id TEXT,
    application_version TEXT NOT NULL,
    event_schema_version INTEGER NOT NULL,
    metadata_json TEXT,
    occurred_at TEXT NOT NULL
);
