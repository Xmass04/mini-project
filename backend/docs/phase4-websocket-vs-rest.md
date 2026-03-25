# Phase 4 — WebSocket vs REST: Explanation & Context

## What Phase 4 Does

The Chrome Extension scrapes application questions from a job form (e.g. "Why do you want this role?") and sends them to the backend. The backend uses Groq/Llama to generate tailored answers based on the user's resume and the specific job description, then sends them back to the extension to fill in the form.

---

## REST vs WebSocket

### REST
- **Backend:** One endpoint, loop through questions, return list of answers.
- **Extension:** `fetch()` → parse JSON → fill fields.
- **Complexity:** Low (~30 lines total).
- **UX:** User waits (e.g. 15s for 5 questions), then all fields fill at once.

### WebSocket
- **Backend:** `ws://` endpoint, keep TCP connection open, push each answer as it's ready.
- **Extension:** `new WebSocket(url)`, send message, listen for incoming messages.
- **Complexity:** Medium (~60 lines + error handling).
- **UX:** Each field fills in ~3s apart. Feels live and progressive.

---

## Why WebSocket Was Recommended

Purely **UX perception**. Total time is identical — WebSocket doesn't make Groq faster. But instead of a 15-second spinner followed by all fields filling at once, the user sees fields being filled one by one every ~3 seconds. It _feels_ faster.

For a local team tool, REST is perfectly fine. WebSocket makes more sense for a SaaS product with many users where perceived responsiveness matters.

---

## REST Flow

```
Extension                    Backend
   |                            |
   |--- POST /extension/answers |
   |    {questions: [Q1,Q2,Q3]} |
   |                            |--- Groq(Q1) → A1
   |                            |--- Groq(Q2) → A2
   |                            |--- Groq(Q3) → A3
   |<-- {answers: [A1,A2,A3]} --|
   |                            |
```

---

## WebSocket Flow

```
Extension                          Backend
   |                                  |
   |--- HTTP Upgrade: WebSocket ----> |   (initial handshake)
   |<-- 101 Switching Protocols ----- |   (TCP connection stays open)
   |                                  |
   |--- {"questions": [...]} -------> |   (client sends once)
   |                                  |
   |<-- {"index":0, "answer":"..."} - |   (~3s, Q1 done)
   |<-- {"index":1, "answer":"..."} - |   (~6s, Q2 done)
   |<-- {"index":2, "answer":"..."} - |   (~9s, Q3 done)
   |<-- {"done": true} -------------- |
   |                                  |
   |--- close ------------------------|
```

---

## Backend Code Comparison

### REST
```python
@router.post("/answers")
def get_answers(body: AnswerRequest, session: Session = Depends(get_session)):
    # fetch resume + job
    # loop through questions, call Groq for each
    # return all answers as JSON list
    return {"answers": [...]}
```

### WebSocket
```python
@router.websocket("/ws/{user_id}/{job_id}")
async def answer_questions(websocket: WebSocket, user_id: int, job_id: int):
    await websocket.accept()                      # accept TCP connection
    data = await websocket.receive_json()         # wait for questions
    for i, question in enumerate(data["questions"]):
        answer = ExtensionService.generate_answer(...)
        await websocket.send_json({"index": i, "answer": answer})  # push immediately
    await websocket.send_json({"done": True})
```

---

## Frontend Code Comparison

### REST (Chrome Extension)
```javascript
const response = await fetch("http://localhost:8000/extension/answers", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({user_id: 1, job_id: 42, resume_id: 1, questions: [...]})
})
const data = await response.json()
data.answers.forEach((item, i) => fillFormField(i, item.answer))
```

### WebSocket (Chrome Extension)
```javascript
const ws = new WebSocket("ws://localhost:8000/extension/ws/1/42")

ws.onopen = () => {
    ws.send(JSON.stringify({resume_id: 1, questions: [...]}))
}

ws.onmessage = (event) => {
    const data = JSON.parse(event.data)
    if (data.done) { ws.close(); return }
    fillFormField(data.index, data.answer)  // fills each field as it arrives
}
```

---

## Computer Networks Connection

WebSocket is a **Layer 7 (Application Layer)** protocol that runs on top of TCP.

**The handshake:**
Client sends a normal HTTP/1.1 request with `Upgrade: websocket` header.
Server replies with `101 Switching Protocols`.
From that point, the TCP connection is no longer HTTP — it's a raw bidirectional channel.

**Key CN concepts involved:**
- TCP 3-way handshake (happens before WebSocket handshake)
- HTTP/1.1 persistent connections vs WebSocket persistent connections
- Full-duplex communication (both sides can send simultaneously)
- `ws://` = port 80, `wss://` = port 443 (TLS-encrypted) — same ports as HTTP/HTTPS

**Core difference from REST at the TCP level:**

| | REST (HTTP) | WebSocket |
|---|---|---|
| TCP connection | Opens per request, closes after response | Opens once, stays open |
| Who can initiate | Client only | Both client and server |
| Server push | Not possible mid-response | Yes, anytime |

---

## Implementation

Both are implemented in this project:
- REST: `app/api/extension_rest.py` → `POST /extension/answers`
- WebSocket: `app/api/extension_ws.py` → `ws://localhost:8000/extension/ws/{user_id}/{job_id}`

Shared service: `app/services/extension.py` → `ExtensionService.generate_answer()`

Test REST with curl or the FastAPI docs (`/docs`).
Test WebSocket with the interactive client at `GET /extension/ws/test`.
