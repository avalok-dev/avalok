from flask import Flask, Blueprint
import redis

app = Flask(__name__)
blueprint = Blueprint("health", __name__)

@app.route("/health", methods=["GET"])
def health():
    return "ok"

