from fastapi import FastAPI
from openai import OpenAI
import boto3
import psycopg

app = FastAPI()
client = OpenAI()
documents = boto3.client("s3")

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/chat")
def chat():
    with psycopg.connect("${DATABASE_URL}"):
        return client.responses.create(model="gpt-5", input="research")
