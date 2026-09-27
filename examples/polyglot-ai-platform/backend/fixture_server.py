import json
import pathlib
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from app.telemetry import emit_trace

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/chat":
            self.send_error(404)
            return
        length = int(self.headers.get("content-length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        prompt = payload.get("prompt", "Explain the fixture")
        status = emit_trace(prompt)
        body = json.dumps({"answer": f"Fixture answer for: {prompt}", "telemetry": status}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        return

if __name__ == "__main__":
    print("Python fixture listening on http://127.0.0.1:4320", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 4320), Handler).serve_forever()

