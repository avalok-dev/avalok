from celery import Celery
import redis

worker = Celery("research-worker", broker="redis://redis:6379/0")
cache = redis.Redis(host="redis")

@worker.task
def store_result(value):
    return value

