.PHONY: help install dev-api dev-web dev build run migrate ddl load demo-seed test clean

EXCEL ?= ./resources/VBM_BU_Register_Master.xlsm
SNAPSHOT ?= Q2
# Local stand-in identity (no Databricks proxy locally), made an unlock admin
# so the full lock/unlock lifecycle can be exercised.
DEV_ACTOR ?= local.dev@vale.com
UNLOCK_ADMINS ?= $(DEV_ACTOR)

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS=":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install:      ## Install python + node dependencies
	python -m pip install -r requirements.txt
	cd frontend && npm install

dev-api:      ## FastAPI on :8000 (JSON backend, no infrastructure)
	DATA_BACKEND=json DEV_ACTOR=$(DEV_ACTOR) UNLOCK_ADMINS=$(UNLOCK_ADMINS) \
	  uvicorn backend.app.main:app --reload --port 8000

dev-web:      ## Vite on :5173, proxying /api to :8000
	cd frontend && npm run dev

build:        ## Compile the SPA into backend/app/static
	cd frontend && npm run build

run:          ## Serve SPA + API from one process on :8000
	uvicorn backend.app.main:app --port 8000

ddl:          ## Print CREATE TABLE for the CURRENT registry
	python -m backend.app.models

migrate:      ## Apply the registry's DDL to the configured database
	python -c "from backend.app.core import ensure_schema; ensure_schema(); print('schema applied')"

load:         ## Load a workbook:  make load EXCEL=... SNAPSHOT=... YEAR=2027
	python -c "import sys,io; \
from backend.app.core import session_scope; \
from backend.app.etl import parse_workbook, load_parse_result; \
raw=open('$(EXCEL)','rb').read(); \
p=parse_workbook(io.BytesIO(raw), snapshot_id='$(SNAPSHOT)', base_year=int('$(YEAR)') if '$(YEAR)' else None); \
[print(s.session) for s in []]; \
exec('with session_scope() as s:\n    r=load_parse_result(s,p,raw_bytes=raw,source_name=\"$(EXCEL)\",snapshot_id=\"$(SNAPSHOT)\")\n    print(r.status, r.message)')"

demo-seed:    ## Generate a synthetic JSON seed so the app runs with no workbook
	python backend/seed_demo.py

test:         ## Smoke-test every endpoint against the JSON backend
	DATA_BACKEND=json python backend/smoke_test.py

clean:
	rm -rf frontend/node_modules backend/app/static backend/app/__pycache__

dev:
	@trap 'kill 0' EXIT INT TERM; \
	$(MAKE) dev-api & \
	$(MAKE) dev-web & \
	wait