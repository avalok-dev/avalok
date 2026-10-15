from celery import Celery

worker = Celery("research-worker", broker="redis://redis:6379/0")

@worker.task
def index_document(document_id: str):
    return document_id
