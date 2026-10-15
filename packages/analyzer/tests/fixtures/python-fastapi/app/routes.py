from fastapi import APIRouter
from .db import engine

router = APIRouter()

@router.post("/chat")
async def chat():
    return {"answer": "fixture"}

