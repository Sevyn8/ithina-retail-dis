include .env
export

.PHONY: help run-local stop-local reset-local test lint format db-migrate db-revision db-reset topics-create dbt-debug dbt-run sync clean

help:
	@echo "DIS local commands:"
	@echo "  make sync          - install all workspace dependencies"
	@echo "  make run-local     - bring up docker stack + create topics + apply migrations"
	@echo "  make stop-local    - stop docker stack (data persists)"
	@echo "  make check         - run pre-flight checks (scripts/check_setup.sh)"
	@echo "  make reset-local   - stop + wipe all data volumes"
	@echo "  make test          - run all tests"
	@echo "  make lint          - run ruff lint"
	@echo "  make format        - run ruff format"
	@echo "  make db-migrate    - apply pending Alembic migrations"
	@echo "  make db-revision   - create a new Alembic migration (autogenerate)"
	@echo "  make db-reset      - drop and recreate Postgres schemas (destructive)"
	@echo "  make topics-create - create Pub/Sub topics on the emulator"
	@echo "  make dbt-debug     - validate dbt config against current target"
	@echo "  make dbt-run       - run dbt models"

sync:
	uv sync

run-local: sync
	docker compose up -d
	@echo "Waiting for Postgres to be ready..."
	@until docker compose exec -T postgres pg_isready -U ithina_dis_user -d ithina_dis_db >/dev/null 2>&1; do sleep 1; done
	@echo "Postgres ready."
	$(MAKE) topics-create
	$(MAKE) db-migrate
	@echo "Local stack up. See 'docker compose ps' for status."

stop-local:
	docker compose down

reset-local:
	docker compose down -v
	@echo "Volumes wiped. Run 'make run-local' to start clean."

check:
	./scripts/check_setup.sh

test:
	uv run pytest

lint:
	uv run ruff check .

format:
	uv run ruff format .

db-migrate:
	uv run alembic upgrade head

db-revision:
	@read -p "Migration message: " msg; \
	uv run alembic revision --autogenerate -m "$$msg"

db-reset:
	@echo "Dropping and recreating ithina_dis_db..."
	@docker compose exec -T postgres psql -U ithina_dis_user -d postgres -c "DROP DATABASE IF EXISTS ithina_dis_db;"
	@docker compose exec -T postgres psql -U ithina_dis_user -d postgres -c "CREATE DATABASE ithina_dis_db;"
	@$(MAKE) db-migrate

topics-create:
	@uv run python tools/local/create_topics.py

dbt-debug:
	cd dbt && uv run dbt debug

dbt-run:
	cd dbt && uv run dbt run

clean:
	rm -rf .venv .ruff_cache .mypy_cache .pytest_cache **/__pycache__ **/*.egg-info dbt/target dbt/logs
