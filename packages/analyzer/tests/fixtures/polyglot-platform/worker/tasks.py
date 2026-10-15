from celery import Celery
import redis

worker = Celery("research", broker="redis://redis:6379/0")
cache = redis.Redis(host="redis")

@worker.task
def summarize(value):
    return value

