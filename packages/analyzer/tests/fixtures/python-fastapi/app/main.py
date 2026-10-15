import os
from fastapi import FastAPI
from openai import OpenAI
from .routes import router
from .db import engine

app = FastAPI()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
app.include_router(router)

@app.get("/health")
async def health():
    return {"status": "ok"}

