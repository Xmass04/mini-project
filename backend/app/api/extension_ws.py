import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from sqlmodel import Session

from app.core.db import engine
from app.models.models import Job, Resume
from app.services.extension import ExtensionService

router = APIRouter(prefix="/extension", tags=["extension-websocket"])

# Simple browser-based test client so you can try the WebSocket without a Chrome Extension
_TEST_CLIENT_HTML = """
<!DOCTYPE html>
<html>
<head><title>WebSocket Test</title></head>
<body>
<h2>WebSocket Answer Generator — Test Client</h2>
<p>Connects to <code>ws://localhost:8000/extension/ws/{user_id}/{job_id}</code></p>
<div>
  <label>user_id: <input id="uid" value="1" style="width:40px"></label>
  <label>job_id: <input id="jid" value="1" style="width:40px"></label>
  <label>resume_id: <input id="rid" value="1" style="width:40px"></label>
</div>
<br>
<label>Questions (one per line):<br>
  <textarea id="questions" rows="4" cols="60">Why do you want this role?
Describe a technical challenge you solved.</textarea>
</label>
<br><br>
<button onclick="connect()">Connect & Send</button>
<button onclick="disconnect()">Disconnect</button>
<hr>
<pre id="log" style="background:#f4f4f4;padding:10px;min-height:100px"></pre>
<script>
  let ws = null;
  function log(msg) {
    document.getElementById("log").textContent += msg + "\\n";
  }
  function connect() {
    const uid = document.getElementById("uid").value;
    const jid = document.getElementById("jid").value;
    const rid = document.getElementById("rid").value;
    const questions = document.getElementById("questions").value
      .split("\\n").map(q => q.trim()).filter(q => q);

    document.getElementById("log").textContent = "";
    ws = new WebSocket(`ws://localhost:8000/extension/ws/${uid}/${jid}`);

    ws.onopen = () => {
      log("[connected]");
      ws.send(JSON.stringify({resume_id: parseInt(rid), questions}));
      log("[sent] " + JSON.stringify({resume_id: rid, questions}));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.error) { log("[error] " + data.error); return; }
      if (data.done)  { log("[done] all answers received"); ws.close(); return; }
      log(`\\n[Q${data.index}] ${data.question}\\n[A${data.index}] ${data.answer}`);
    };

    ws.onclose = () => log("[disconnected]");
    ws.onerror = (e) => log("[ws error] " + e);
  }
  function disconnect() { if (ws) ws.close(); }
</script>
</body>
</html>
"""


@router.get("/ws/test", response_class=HTMLResponse)
def websocket_test_client():
    """Open this in a browser to test the WebSocket endpoint interactively."""
    return _TEST_CLIENT_HTML


@router.websocket("/ws/{user_id}/{job_id}")
async def answer_questions_ws(websocket: WebSocket, user_id: int, job_id: int):
    """
    WebSocket endpoint for the Chrome Extension.

    Client sends one JSON message after connecting:
        {"resume_id": <int>, "questions": ["Q1", "Q2", ...]}

    Server pushes one message per answer as each Groq call finishes:
        {"index": 0, "question": "Q1", "answer": "..."}
        {"index": 1, "question": "Q2", "answer": "..."}
        {"done": true}

    On error:
        {"error": "<message>"}  then the connection closes.
    """
    await websocket.accept()

    try:
        raw = await websocket.receive_text()
        try:
            payload = json.loads(raw)
            questions: list[str] = payload["questions"]
            resume_id: int = payload["resume_id"]
        except (json.JSONDecodeError, KeyError) as exc:
            await websocket.send_json({"error": f"Invalid payload: {exc}"})
            await websocket.close()
            return

        with Session(engine) as session:
            resume = session.get(Resume, resume_id)
            if not resume or resume.user_id != user_id:
                await websocket.send_json({"error": "Resume not found."})
                await websocket.close()
                return

            job = session.get(Job, job_id)
            if not job or job.user_id != user_id:
                await websocket.send_json({"error": "Job not found."})
                await websocket.close()
                return

            resume_md = resume.markdown_content
            job_desc = job.description

        for index, question in enumerate(questions):
            answer = ExtensionService.generate_answer(resume_md, job_desc, question)
            await websocket.send_json({"index": index, "question": question, "answer": answer})

        await websocket.send_json({"done": True})

    except WebSocketDisconnect:
        pass
