from openai import OpenAI

client = OpenAI()

def deterministic_answer(prompt: str) -> str:
    return f"Fixture answer for: {prompt}"

