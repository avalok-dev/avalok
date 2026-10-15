from fastapi import FastAPI
from openai import OpenAI
from sqlalchemy import create_engine

app = FastAPI()
model = OpenAI()
database = create_engine("postgresql://postgres/research")

@app.post("/chat")
async def chat():
    return {"answer": "deterministic"}

