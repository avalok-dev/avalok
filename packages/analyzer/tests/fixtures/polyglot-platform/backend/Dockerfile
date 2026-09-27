FROM python:3.13-slim
WORKDIR /app
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--port", "8000"]

