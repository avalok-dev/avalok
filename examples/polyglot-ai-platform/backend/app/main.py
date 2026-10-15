from fastapi import FastAPI
from pydantic import BaseModel
from .agent import deterministic_answer
from .telemetry import emit_trace

app = FastAPI(title="Research API")

class ChatRequest(BaseModel):
    prompt: str

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/chat")
async def chat(request: ChatRequest):
    answer = deterministic_answer(request.prompt)
    emit_trace(request.prompt)
    return {"answer": answer}

