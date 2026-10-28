import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from app.modules.imports.archive import FileTooLargeError, archive_upload
from app.modules.imports.publication import (
    NotPublishableError,
    PublicationService,
    StructureChangeRequiresConfirmationError,
    preview_structure_change,
)
from app.modules.imports.service import ImportResult, parse_and_validate

router = APIRouter(prefix="/api/imports", tags=["imports"])


@dataclass
class StoredImport:
    import_id: str
    result: ImportResult
    archived_path: Optional[Path]
    sha256: Optional[str]


class PublishRequest(BaseModel):
    region_code: str
    revision_cycle_year: int
    confirm_structure_change: bool = False


def _issue_payload(issues):
    return [
        {"code": i.code, "severity": i.severity.value, "message": i.message,
         "sheet": i.sheet, "row": i.row, "column": i.column, "node_code": i.node_code}
        for i in issues
    ]


def _structure_change_payload(change):
    return {
        "added": [{"tree_code": r.tree_code, "node_code": r.node_code, "kpi_name": r.kpi_name}
                  for r in change.added],
        "removed": [{"tree_code": r.tree_code, "node_code": r.node_code, "kpi_name": r.kpi_name}
                    for r in change.removed],
        "changed": [{"tree_code": c.tree_code, "node_code": c.node_code, "kpi_name": c.kpi_name,
                     "fields": c.fields} for c in change.changed],
    }


def _result_payload(conn, stored: StoredImport):
    result = stored.result
    counts = {"BLOCKING": 0, "WARNING": 0}
    for issue in result.issues:
        counts[issue.severity.value] += 1
    structure_change = preview_structure_change(conn, result.parsed)
    return {
        "import_id": stored.import_id,
        "is_publishable": result.is_publishable,
        "region_code": result.parsed.region_code,
        "region_name": result.parsed.region_name,
        "revision_cycle_year": result.parsed.revision_cycle_year,
        "template_version": result.parsed.template_version,
        "tree_count": len(result.parsed.trees),
        "node_count": sum(len(t.nodes) for t in result.parsed.trees),
        "sha256": stored.sha256,
        "issue_count": counts,
        "issues": _issue_payload(result.issues),
        "structure_change": (_structure_change_payload(structure_change)
                             if structure_change else None),
    }


@router.post("/validate")
async def validate_import(request: Request, file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(400, {"code": "INVALID_FILE_TYPE",
                                  "message": "Only .xlsx workbooks are accepted"})

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(await file.read())
        temp_path = Path(tmp.name)

    try:
        archived = None
        if request.app.state.archive_dir is not None:
            try:
                archived = archive_upload(temp_path, request.app.state.archive_dir, file.filename)
            except FileTooLargeError as exc:
                raise HTTPException(413, {"code": "FILE_TOO_LARGE", "message": str(exc)})
        try:
            result = parse_and_validate(temp_path)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(400, {"code": "UNREADABLE_WORKBOOK",
                                      "message": "The file could not be read as an .xlsx workbook"})

        stored = StoredImport(
            import_id=str(uuid.uuid4()), result=result,
            archived_path=archived.path if archived else None,
            sha256=archived.sha256 if archived else None,
        )
        request.app.state.imports[stored.import_id] = stored
        return _result_payload(request.app.state.db, stored)
    finally:
        temp_path.unlink(missing_ok=True)


@router.get("/{import_id}")
def get_import(request: Request, import_id: str):
    stored = request.app.state.imports.get(import_id)
    if stored is None:
        raise HTTPException(404, {"code": "IMPORT_NOT_FOUND",
                                  "message": "No validated import with that identifier"})
    return _result_payload(request.app.state.db, stored)


@router.post("/{import_id}/publish")
def publish_import(request: Request, import_id: str, body: PublishRequest):
    stored = request.app.state.imports.get(import_id)
    if stored is None:
        raise HTTPException(404, {"code": "IMPORT_NOT_FOUND",
                                  "message": "No validated import with that identifier"})

    parsed = stored.result.parsed
    if (body.region_code != parsed.region_code
            or body.revision_cycle_year != parsed.revision_cycle_year):
        raise HTTPException(409, {
            "code": "SCOPE_CONFIRMATION_MISMATCH",
            "message": (f"This workbook publishes {parsed.region_code} cycle "
                        f"{parsed.revision_cycle_year}; the confirmation did not match"),
        })

    if not stored.result.is_publishable:
        raise HTTPException(409, {"code": "NOT_PUBLISHABLE",
                                  "message": "This import has blocking issues"})

    service = PublicationService(request.app.state.db, request.app.state.archive_dir)
    try:
        # Serializes publications: the spec requires a lock on the scope, and
        # the shared SQLite connection needs one regardless.
        with request.app.state.db_write_lock:
            summary = service.publish(stored.result, parsed.template_version,
                                      confirm_structure_change=body.confirm_structure_change)
    except StructureChangeRequiresConfirmationError as exc:
        raise HTTPException(409, {
            "code": "STRUCTURE_CHANGE_REQUIRES_CONFIRMATION",
            "structure_change": _structure_change_payload(exc.change),
        })
    except NotPublishableError as exc:
        raise HTTPException(409, {"code": "NOT_PUBLISHABLE", "message": str(exc)})

    return {
        "import_id": import_id,
        "dataset_id": summary.dataset_id,
        "dataset_cycle_id": summary.dataset_cycle_id,
        "region_code": parsed.region_code,
        "revision_cycle_year": parsed.revision_cycle_year,
        "node_count": summary.node_count,
        "value_count": summary.value_count,
    }
