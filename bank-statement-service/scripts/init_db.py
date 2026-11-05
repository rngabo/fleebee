"""Prepare the database before the service starts.

* Postgres (docker): nothing to do here; the container runs `alembic upgrade head`.
* SQLite (home computer, no Postgres available): the migrations use Postgres-only operations, so a fresh database is
  built straight from the models and marked as being at the latest migration. An existing database is upgraded with
  alembic as usual (future migrations must therefore stay SQLite-friendly, e.g. use batch operations).
"""
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

import app.models  # noqa: F401  (registers every table on Base)
from app.core.config import get_settings
from app.db.session import Base


def main() -> None:
    url = get_settings().database_url
    if not url.startswith("sqlite"):
        print("Not SQLite; migrations are run by alembic.")
        return
    engine = create_engine(url)
    config = Config("alembic.ini")
    if "alembic_version" in inspect(engine).get_table_names():
        command.upgrade(config, "head")
        print("SQLite database upgraded.")
    else:
        Base.metadata.create_all(engine)
        command.stamp(config, "head")
        print("SQLite database created from the models and stamped at head.")


if __name__ == "__main__":
    main()
