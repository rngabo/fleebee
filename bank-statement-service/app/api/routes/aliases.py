import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import require_api_key
from app.db.session import get_db
from app.models.alias import PayerAlias
from app.services.naming import alias_key

router = APIRouter(prefix="/api/v1/aliases", tags=["aliases"], dependencies=[Depends(require_api_key)])


class AliasIn(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    biker_id: str = Field(min_length=1, max_length=64)
    biker_name: str = Field(min_length=1, max_length=255)


def _row(alias: PayerAlias) -> dict:
    return {
        "id": str(alias.id),
        "name_key": alias.name_key,
        "display_name": alias.display_name,
        "biker_id": alias.biker_id,
        "biker_name": alias.biker_name,
        "use_count": alias.use_count,
        "updated_at": alias.updated_at.isoformat() if alias.updated_at else None,
    }


@router.get("")
def list_aliases(db: Session = Depends(get_db)) -> dict:
    return {"items": [_row(alias) for alias in db.scalars(select(PayerAlias).order_by(PayerAlias.display_name))]}


@router.put("")
def save_alias(body: AliasIn, db: Session = Depends(get_db)) -> dict:
    """Remember (or correct) which rider this payer name stands for."""
    key = alias_key(body.name)
    if not key:
        raise HTTPException(status_code=422, detail="The payer name has no letters to remember")
    alias = db.scalar(select(PayerAlias).where(PayerAlias.name_key == key))
    if alias:
        alias.biker_id, alias.biker_name, alias.display_name = body.biker_id, body.biker_name, " ".join(body.name.split())
    else:
        alias = PayerAlias(name_key=key, display_name=" ".join(body.name.split()), biker_id=body.biker_id, biker_name=body.biker_name)
        db.add(alias)
    db.commit()
    db.refresh(alias)
    return _row(alias)


@router.delete("/{alias_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_alias(alias_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    alias = db.get(PayerAlias, alias_id)
    if not alias:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(alias)
    db.commit()
