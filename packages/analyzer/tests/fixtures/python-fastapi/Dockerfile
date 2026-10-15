FROM python:3.13-slim AS runtime
WORKDIR /app
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

