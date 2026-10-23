"""
=============================================================================
THE SINGLE PLACE TO CHANGE THE SCHEMA.
=============================================================================

Everything below this file is *derived*. Adding a column to the register, or
renaming a spreadsheet header, or introducing a new controlled vocabulary, is
an edit to THIS FILE and nothing else. Concretely, the following are all
generated from the declarations here:

    backend/app/models.py       SQLAlchemy columns + DDL
    backend/app/schemas.py      Pydantic read / create / patch contracts
    backend/app/etl.py          Excel header location + coercion + validation
    backend/app/analytics.py    Completeness sections, required-field scoring
    backend/app/api.py          /meta/fields  -> the UI's column + form config
    frontend/src/*              register grid, editor form, filters (runtime)

Open/Closed in practice: the modules above are *closed* for modification and
*open* for extension through this registry.

-----------------------------------------------------------------------------
HOW TO MAKE THE THREE CHANGES YOU WILL ACTUALLY MAKE
-----------------------------------------------------------------------------
1. New column in the register
       append one FieldSpec(...) to INITIATIVE_FIELDS.
2. Spreadsheet renamed a header
       edit that FieldSpec's `excel=` tuple. Nothing else moves.
3. New controlled vocabulary / new BU / new stage
       add to VOCAB. Aliases are data, not code.

A new monthly block (e.g. 2028 KPI actuals) is a MetricBlock entry, not a
schema migration -- monthly facts are stored narrow.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Iterable

# ============================================================ field kinds ===


class Kind(str, Enum):
    """What a field *is*. Every downstream concern keys off this."""

    TEXT = "text"
    LONGTEXT = "longtext"
    INT = "int"
    NUMBER = "number"
    MONEY = "money"          # stored in USD units, presented as $M
    BOOL = "bool"
    DATE = "date"
    VOCAB = "vocab"          # resolved through VOCAB[domain]


class Match(str, Enum):
    """How to find this field's column in an arbitrary workbook."""

    EQUALS = "equals"
    CONTAINS = "contains"
    STARTSWITH = "startswith"


@dataclass(frozen=True)
class FieldSpec:
    name: str                          # canonical column / JSON key
    label: str                         # what a human sees
    kind: Kind
    section: str                       # completeness section AND editor group
    required: bool = False             # counts towards `scope=required`
    vocab: str | None = None           # domain name when kind is VOCAB
    excel: tuple[str, ...] = ()        # normalised header candidates
    match: Match = Match.CONTAINS
    editable: bool = True              # exposed by the Initiatives editor
    filterable: bool = False           # exposed as an API/UI filter
    grid: bool = True                  # shown in the register grid by default
    groupable: bool = False            # allowed as a tree / stack dimension
    max_length: int | None = None
    help: str | None = None

    @property
    def column(self) -> str:
        """Physical column name. Vocab fields carry a `_code` suffix."""
        return f"{self.name}_code" if self.kind is Kind.VOCAB else self.name


# =============================================================== vocabulary ==
# Controlled vocabularies. `terms` are canonical; `aliases` absorb the five
# spellings five BUs will send you. The client's ETL adds aliases, not code.


@dataclass(frozen=True)
class VocabDomain:
    domain: str
    label: str
    terms: tuple[tuple[str, str, int, str | None], ...]   # code, label, order, colour
    aliases: dict[str, str] = field(default_factory=dict)
    fallback: str | None = None       # used when a value is present but unknown


VOCAB: dict[str, VocabDomain] = {
    "bu": VocabDomain(
        "bu", "Business Unit",
        (
            ("ONT", "Ontario", 10, "#2C6E9B"),
            ("VNL", "VNL", 20, "#C77D28"),
            ("SSG", "Sossego", 30, "#3E9E74"),
            ("SAL", "Salobo", 40, "#7E5AA6"),
            ("ONP", "Onça Puma", 50, "#C0574E"),
        ),
        {
            "ontario": "ONT", "ont": "ONT",
            "vnl": "VNL", "voiseysbay": "VNL", "longharbour": "VNL",
            "sossego": "SSG", "ssg": "SSG",
            "salobo": "SAL", "sal": "SAL",
            "oncapuma": "ONP", "onp": "ONP", "oncapumabu": "ONP",
        },
    ),
    "stage": VocabDomain(
        "stage", "Initiative Stage",
        (
            ("NOT STARTED", "Not Started", 0, "#CFCFCF"),
            ("EVALUATING", "Evaluating", 10, "#6B7785"),
            ("IMPLEMENTING", "Implementing", 20, "#2C7FB8"),
            ("CASH_FLOWING", "Cash flowing", 30, "#1FA971"),
            ("LOCKED_IN", "Locked-in", 40, "#7E5AA6"),
            ("ON_HOLD", "On hold", 50, "#E8A93C"),
            ("CLOSED", "Closed", 60, "#8A94A2"),
            ("CANCELLED", "Cancelled", 70, "#E03E2D"),
        ),
        {
            "not started": "NOT STARTED", "created": "NOT STARTED",
            "evaluating": "EVALUATING", "preexecution": "EVALUATING",
            "implementing": "IMPLEMENTING", "earlyexecution": "IMPLEMENTING",
            "cashflowing": "CASH_FLOWING", "advancedexecution": "CASH_FLOWING",
            "lockedin": "LOCKED_IN", "sustaining": "LOCKED_IN",
            "onhold": "ON_HOLD", "paused": "ON_HOLD",
            "closed": "CLOSED", "complete": "CLOSED", "completed": "CLOSED",
            "cancelled": "CANCELLED", "canceled": "CANCELLED",
        },
    ),
    "track": VocabDomain(
        "track", "On / Off Track",
        (
            ("ON", "On", 10, "#1FA971"),
            ("AT_RISK", "At Risk", 20, "#E8A93C"),
            ("OFF", "Off", 30, "#E03E2D"),
            ("UNKNOWN", "Unknown", 40, "#8A94A2"),
        ),
        {
            "on": "ON", "ontrack": "ON", "y": "ON",
            "off": "OFF", "offtrack": "OFF", "n": "OFF",
            "atrisk": "AT_RISK", "risk": "AT_RISK",
            "unknown": "UNKNOWN", "na": "UNKNOWN", "tbd": "UNKNOWN",
        },
        fallback="UNKNOWN",
    ),
    "lever": VocabDomain(
        "lever", "Value Lever",
        (
            ("COST", "Cost Reduction / Cost Avoidance", 10, "#2C6E9B"),
            ("PRODUCTIVITY", "Productivity / Capability Improvement", 20, "#3E9E74"),
            ("WORKING_CAPITAL", "Working Capital", 30, "#7E5AA6"),
            ("REVENUE", "Revenue Uplift", 40, "#C77D28"),
            ("ENABLING", "Non-financial / Enabling", 50, "#6B7785"),
        ),
        {
            "costreduction": "COST", "costavoidance": "COST",
            "costreductioncostavoidance": "COST",
            "productivityimprovement": "PRODUCTIVITY",
            "capabilityimprovement": "PRODUCTIVITY",
            "productivityimprovementcapabilityimprovement": "PRODUCTIVITY",
            "workingcapital": "WORKING_CAPITAL",
            "revenueuplift": "REVENUE", "revenue": "REVENUE",
            "nonfinancialenabling": "ENABLING", "nonfinancial": "ENABLING",
            "enabling": "ENABLING",
        },
    ),
    "confidence": VocabDomain(
        "confidence", "Value Realization Confidence",
        (
            ("HIGH", "High", 10, "#1FA971"),
            ("MEDIUM", "Medium", 20, "#E8A93C"),
            ("LOW", "Low", 30, "#E03E2D"),
            ("NOT_SET", "Not set", 40, "#8A94A2"),
        ),
        {
            "h": "HIGH", "hi": "HIGH", "high": "HIGH",
            "m": "MEDIUM", "med": "MEDIUM", "medium": "MEDIUM",
            "l": "LOW", "lo": "LOW", "low": "LOW",
            "notset": "NOT_SET", "tbd": "NOT_SET", "na": "NOT_SET",
            "none": "NOT_SET", "pending": "NOT_SET",
        },
        fallback="NOT_SET",
    ),
    "opex_capex": VocabDomain(
        "opex_capex", "OPEX / CAPEX",
        (("OPEX", "OPEX", 10, None), ("CAPEX", "CAPEX", 20, None),
         ("MIXED", "Mixed", 30, None)),
        {"opex": "OPEX", "operating": "OPEX", "capex": "CAPEX",
         "capital": "CAPEX", "mixed": "MIXED", "both": "MIXED"},
    ),
}

# Levers where a LOWER actual beats the target. Attainment is direction-aware;
# averaging naively would flatter cost initiatives.
LOWER_IS_BETTER_LEVERS: frozenset[str] = frozenset({"COST", "WORKING_CAPITAL"})

# Stage semantics, declared once, consumed by analytics.
IN_EXECUTION_STAGES: frozenset[str] = frozenset({"IMPLEMENTING", "CASH_FLOWING"})
REALIZED_STAGES: frozenset[str] = frozenset({"CASH_FLOWING", "LOCKED_IN"})
ON_TRACK_CODE = "ON"

# Codes that mean "nobody answered" even though the cell is populated.
EMPTY_CODES: frozenset[str] = frozenset({"UNKNOWN", "NOT_SET"})


# ================================================================== fields ===
S_ID = "1 · Identification"
S_ALIGN = "2 · Strategic Alignment"
S_PMO = "3 · PMO Rigour"
S_KPI = "4 · KPI & Value Quantification"
S_FIN = "5 · Financial Value"
S_NOTES = "8 · Notes"

INITIATIVE_FIELDS: tuple[FieldSpec, ...] = (
    # -- identity ---------------------------------------------------------
    FieldSpec("source_initiative_id", "Initiative ID", Kind.TEXT, S_ID,
              required=True, excel=("initiativeid",), match=Match.EQUALS,
              editable=False, max_length=64,
              help="Natural key within a BU and snapshot. Never reassigned."),
    FieldSpec("name", "Initiative Name", Kind.LONGTEXT, S_ID, required=True,
              excel=("initiativename",), match=Match.EQUALS),
    FieldSpec("bu", "BU", Kind.VOCAB, S_ID, required=True, vocab="bu",
              excel=("bu",), match=Match.EQUALS, filterable=True, groupable=True,
              editable=False),
    FieldSpec("site", "Site / Area", Kind.TEXT, S_ID, required=True,
              excel=("sitearea", "site"), match=Match.STARTSWITH,
              groupable=True, max_length=256),
    FieldSpec("program", "Program Name", Kind.TEXT, S_ID,
              excel=("programname",), groupable=True, max_length=256),
    FieldSpec("stage", "Initiative Stage", Kind.VOCAB, S_ID, required=True,
              vocab="stage", excel=("initiativestage",), filterable=True,
              groupable=True),
    FieldSpec("track", "On / Off Track", Kind.VOCAB, S_ID, required=True,
              vocab="track", excel=("onofftrack",), filterable=True,
              groupable=True),

    # -- strategic alignment ---------------------------------------------
    FieldSpec("aligned_lobp", "Aligned with LoBP Lever", Kind.BOOL, S_ALIGN,
              required=True, excel=("alignedwithlobp",)),
    FieldSpec("lobp_lever", "LoBP Lever / Workstream", Kind.TEXT, S_ALIGN,
              required=True, excel=("lobplever",), groupable=True),
    FieldSpec("lever", "Value Lever", Kind.VOCAB, S_ALIGN, required=True,
              vocab="lever", excel=("valuelever",), match=Match.EQUALS,
              filterable=True, groupable=True),
    FieldSpec("opex_capex", "OPEX / CAPEX", Kind.VOCAB, S_ALIGN, required=True,
              vocab="opex_capex", excel=("opexcapex",), groupable=True),
    FieldSpec("bottleneck_uplift", "Production Uplift on Bottleneck", Kind.BOOL,
              S_ALIGN, excel=("productionupliftonbottleneck",)),

    # -- PMO --------------------------------------------------------------
    FieldSpec("owner", "Initiative Owner", Kind.TEXT, S_PMO, required=True,
              excel=("initiativeowner",), max_length=256),
    FieldSpec("sponsor", "Initiative Sponsor", Kind.TEXT, S_PMO, required=True,
              excel=("initiativesponsor",), max_length=256),

    # -- KPI --------------------------------------------------------------
    FieldSpec("kpi_name", "Impacted KPI", Kind.TEXT, S_KPI, required=True,
              excel=("impactedkpi",), match=Match.EQUALS),
    FieldSpec("kpi_uom", "UoM", Kind.TEXT, S_KPI, required=True,
              excel=("uom",), match=Match.EQUALS, max_length=64),
    FieldSpec("kpi_baseline", "KPI Baseline Value", Kind.NUMBER, S_KPI,
              required=True, excel=("kpibaselinevalue",)),
    FieldSpec("kpi_target_cy", "Current Year KPI Target", Kind.NUMBER, S_KPI,
              required=True, excel=("currentyearkpitarget",)),
    FieldSpec("actions_total", "Total Actions / Milestones", Kind.INT, S_KPI,
              required=True, excel=("totalactions", "actionsmilestones")),
    FieldSpec("actions_done", "Actions Completed", Kind.INT, S_KPI,
              required=True, excel=("actionscompleted",)),

    # -- financial --------------------------------------------------------
    FieldSpec("value_target_cy", "Current Year Value Target", Kind.MONEY, S_FIN,
              required=True, excel=("currentyearvaluetarget",)),
    FieldSpec("value_realized_cy", "Current Year Value Realized", Kind.MONEY,
              S_FIN, required=True, excel=("currentyearvaluerealized",)),
    FieldSpec("value_target_ny", "Next Year Value Target", Kind.MONEY, S_FIN,
              excel=("nextyearvaluetarget",)),
    FieldSpec("investment_cy", "Investment Required", Kind.MONEY, S_FIN,
              excel=("investmentrequired",)),
    FieldSpec("confidence", "Value Realization Confidence", Kind.VOCAB, S_FIN,
              required=True, vocab="confidence",
              excel=("valuerealizationconfidence",), filterable=True,
              groupable=True),
    FieldSpec("planned_start", "Planned Start Date", Kind.DATE, S_FIN,
              excel=("plannedstartdate",), grid=False),
    FieldSpec("planned_end", "Planned End Date", Kind.DATE, S_FIN,
              required=True, excel=("plannedenddate",),
              help="Drives the value-landing quarter chart."),

    # -- notes ------------------------------------------------------------
    FieldSpec("notes", "Notes / Dependencies", Kind.LONGTEXT, S_NOTES,
              excel=("notesdependencies", "notes"), grid=False),
)

BY_NAME: dict[str, FieldSpec] = {f.name: f for f in INITIATIVE_FIELDS}
BY_COLUMN: dict[str, FieldSpec] = {f.column: f for f in INITIATIVE_FIELDS}


# ==================================================== derived monthly facts ==
@dataclass(frozen=True)
class MetricBlock:
    """
    A wide monthly block in the workbook -> narrow rows in the warehouse.

    `banner` is the section marker on row 0 of the sheet ("6A", "7C", ...).
    Adding 2028 is one line here. It is never a schema migration, because
    `initiative_metric_monthly` is keyed (initiative, metric, scenario, month).
    """

    banner: str
    metric_code: str
    scenario_code: str
    year_offset: int = 0        # 0 = current year, 1 = next year


METRIC_BLOCKS: tuple[MetricBlock, ...] = (
    MetricBlock("6A", "KPI", "TARGET", 0),
    MetricBlock("6B", "KPI", "TARGET", 1),
    MetricBlock("6C", "KPI", "ACTUAL", 0),
    MetricBlock("6D", "KPI", "ACTUAL", 1),
    MetricBlock("7A", "FINANCIAL_VALUE", "TARGET", 0),
    MetricBlock("7C", "FINANCIAL_VALUE", "ACTUAL", 0),
)

# Monthly coverage is scored for completeness like any other field, but it is
# derived from facts rather than a scalar column.
MONTHLY_COMPLETENESS: tuple[tuple[str, str, str, str, bool], ...] = (
    # pseudo-field, label, metric, scenario, required
    ("__kpi_target", "KPI monthly target", "KPI", "TARGET", True),
    ("__kpi_actual", "KPI monthly actual", "KPI", "ACTUAL", True),
    ("__fin_target", "Financial monthly target", "FINANCIAL_VALUE", "TARGET", False),
    ("__fin_actual", "Financial monthly actual", "FINANCIAL_VALUE", "ACTUAL", False),
)
S_KPI_MONTHLY = "6 · KPI Monthly"
S_FIN_MONTHLY = "7 · Financial Monthly"
MONTHLY_SECTION = {"KPI": S_KPI_MONTHLY, "FINANCIAL_VALUE": S_FIN_MONTHLY}


# ================================================================ helpers ====
_PUNCT_STRIP = re.compile(r"[^a-z0-9]+")


def normalise(value: object) -> str:
    """Casefold, strip accents, drop punctuation. 'Onça Puma' -> 'oncapuma'."""
    if value is None:
        return ""
    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return _PUNCT_STRIP.sub("", text.strip().lower())


def resolve_vocab(domain: str, value: object) -> tuple[str | None, bool]:
    """
    (canonical_code, matched). `matched=False` means we fell back -- the loader
    turns those into warnings so a BU is told exactly what to fix.
    """
    dom = VOCAB.get(domain)
    if dom is None:
        return None, False
    key = normalise(value)
    if key in dom.aliases:
        return dom.aliases[key], True
    for code, label, _o, _c in dom.terms:
        if key in (normalise(label), normalise(code)):
            return code, True
    if key == "":
        return dom.fallback, True
    return dom.fallback, False


def label_of(domain: str, code: str | None) -> str:
    if not code:
        return "—"
    for c, label, _o, _col in VOCAB.get(domain, VOCAB["bu"]).terms:
        if c == code:
            return label
    return code


def order_of(domain: str) -> dict[str, int]:
    return {c: o for c, _l, o, _col in VOCAB[domain].terms}


def match_header(spec: FieldSpec, header_norm: str) -> bool:
    """One header-matching rule, declared per field, applied everywhere."""
    if not spec.excel:
        return False
    if spec.match is Match.EQUALS:
        return header_norm in spec.excel
    if spec.match is Match.STARTSWITH:
        return any(header_norm.startswith(c) for c in spec.excel)
    return any(c in header_norm for c in spec.excel)


def sections() -> list[str]:
    """Ordered section names, scalar sections plus the two monthly ones."""
    out: list[str] = []
    for f in INITIATIVE_FIELDS:
        if f.section not in out:
            out.append(f.section)
    out.extend([S_KPI_MONTHLY, S_FIN_MONTHLY])
    return sorted(out)


def scored_fields(scope: str = "required") -> list[tuple[str, str, str]]:
    """(field, label, section) tuples used by completeness scoring."""
    out = [(f.column, f.label, f.section) for f in INITIATIVE_FIELDS
           if scope == "all" or f.required]
    out += [(pseudo, label, MONTHLY_SECTION[metric])
            for pseudo, label, metric, _scn, req in MONTHLY_COMPLETENESS
            if scope == "all" or req]
    return out


def groupable_dimensions() -> list[str]:
    """Dimensions the treemap / decomposition tree / stacked charts may use."""
    return [f.column for f in INITIATIVE_FIELDS if f.groupable]


def filterable_fields() -> list[FieldSpec]:
    return [f for f in INITIATIVE_FIELDS if f.filterable]


def editable_fields() -> list[FieldSpec]:
    return [f for f in INITIATIVE_FIELDS if f.editable]


def describe() -> dict[str, Any]:
    """
    The registry, as JSON, for the UI.

    The React app builds its grid columns, its editor form and its filter
    controls from this payload. That is why a new field needs no frontend
    change either -- the contract is data, not TypeScript.
    """
    return {
        "sections": sections(),
        "fields": [
            {
                "name": f.name, "column": f.column, "label": f.label,
                "kind": f.kind.value, "section": f.section,
                "required": f.required, "vocab": f.vocab,
                "editable": f.editable, "filterable": f.filterable,
                "grid": f.grid, "groupable": f.groupable, "help": f.help,
            }
            for f in INITIATIVE_FIELDS
        ],
        "vocab": {
            d.domain: {
                "label": d.label,
                "terms": [{"code": c, "label": l, "sort_order": o, "color_hex": col}
                          for c, l, o, col in d.terms],
            }
            for d in VOCAB.values()
        },
        "groupable": groupable_dimensions(),
        "metric_blocks": [
            {"metric_code": b.metric_code, "scenario_code": b.scenario_code}
            for b in METRIC_BLOCKS
        ],
        "stage_semantics": {
            "in_execution": sorted(IN_EXECUTION_STAGES),
            "realized": sorted(REALIZED_STAGES),
            "on_track": ON_TRACK_CODE,
        },
    }


# ------------------------------------------------------------ coercion ------
def _to_bool(v: Any) -> bool | None:
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return v
    return normalise(v) in {"y", "yes", "true", "1", "sim", "s"}


def _to_number(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    text = re.sub(r"[^\d,.\-]", "", str(v))
    if not text or text in {"-", ".", ","}:
        return None
    if "," in text and "." in text:
        text = text.replace(",", "") if text.rfind(".") > text.rfind(",") \
            else text.replace(".", "").replace(",", ".")
    elif "," in text:
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def _to_date(v: Any) -> Any:
    import datetime as dt

    if v is None or v == "":
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%b-%Y", "%Y/%m/%d"):
        try:
            return dt.datetime.strptime(str(v).strip(), fmt).date()
        except ValueError:
            continue
    return None


def _to_text(v: Any, limit: int | None) -> str | None:
    if v is None:
        return None
    text = str(v).strip()
    if not text or normalise(text) in {"tbd", "na", "none", "inprogress"}:
        return None
    return text[:limit] if limit else text


COERCERS: dict[Kind, Callable[[Any, FieldSpec], Any]] = {
    Kind.TEXT: lambda v, f: _to_text(v, f.max_length),
    Kind.LONGTEXT: lambda v, f: _to_text(v, None),
    Kind.BOOL: lambda v, f: _to_bool(v),
    Kind.DATE: lambda v, f: _to_date(v),
    Kind.NUMBER: lambda v, f: _to_number(v),
    Kind.MONEY: lambda v, f: _to_number(v),
    Kind.INT: lambda v, f: (None if _to_number(v) is None else int(_to_number(v))),
    Kind.VOCAB: lambda v, f: resolve_vocab(f.vocab or "", v)[0],
}


def coerce(spec: FieldSpec, value: Any) -> Any:
    """One coercion path, chosen by Kind. The ETL and the API editor share it."""
    return COERCERS[spec.kind](value, spec)


def has_value(row: dict, column: str) -> bool:
    """
    Is this cell answered? Monthly pseudo-fields are scored from facts.
    A deliberate 'Unknown' does not count as answered.
    """
    if column.startswith("__"):
        spec = next(m for m in MONTHLY_COMPLETENESS if m[0] == column)
        _p, _l, metric, scenario, _r = spec
        return any(m.get("metric_code") == metric
                   and m.get("scenario_code") == scenario
                   and m.get("value") not in (None, 0)
                   for m in (row.get("metrics") or []))
    v = row.get(column)
    if v is None:
        return False
    if isinstance(v, bool):
        return True
    text = str(v).strip()
    return bool(text) and text not in EMPTY_CODES and text != "—"


def iter_fields(kinds: Iterable[Kind] | None = None) -> Iterable[FieldSpec]:
    if kinds is None:
        yield from INITIATIVE_FIELDS
        return
    wanted = set(kinds)
    yield from (f for f in INITIATIVE_FIELDS if f.kind in wanted)
