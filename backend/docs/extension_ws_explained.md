# extension_ws.py — Code Walkthrough

## What this file does in one line
It runs a WebSocket server that accepts questions from the Chrome Extension (or browser), calls Groq once per question, and pushes each answer back as soon as it's ready.

---

## File structure at a glance

```
extension_ws.py
│
├── imports
├── _TEST_CLIENT_HTML      ← raw HTML string (the browser test UI)
│
├── GET /extension/ws/test ← serves the HTML above as a webpage
└── WS  /extension/ws/{user_id}/{job_id}  ← the actual WebSocket logic
```

---

## Section by section

### 1. Imports (lines 1–11)

```python
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from sqlmodel import Session

from app.core.db import engine
from app.models.models import Job, Resume
from app.services.extension import ExtensionService
```

- `WebSocket` — FastAPI's class that represents an open WebSocket connection. Has methods like `accept()`, `receive_text()`, `send_json()`, `close()`.
- `WebSocketDisconnect` — exception FastAPI raises when the client closes the connection mid-session. We catch it so the server doesn't crash.
- `HTMLResponse` — tells FastAPI to send the response as `text/html` instead of `application/json`.
- `Session(engine)` — opens a DB session directly (not via `Depends(get_session)`) because WebSocket route functions can't use FastAPI's dependency injection the same way HTTP routes can.

---

### 2. _TEST_CLIENT_HTML (lines 14–71)

```python
_TEST_CLIENT_HTML = """<!DOCTYPE html>..."""
```

A plain Python string containing a full HTML page. Nothing special — just stored as a variable so `websocket_test_client()` can return it.

The HTML itself has:
- Three input fields: `user_id`, `job_id`, `resume_id`
- A textarea for questions (one per line)
- Two buttons: Connect & Send / Disconnect
- A `<pre>` log box where messages are printed

The JavaScript inside does:
```javascript
// 1. open a WebSocket connection to our backend
ws = new WebSocket(`ws://localhost:8000/extension/ws/${uid}/${jid}`)

// 2. as soon as connected, send the questions
ws.onopen = () => ws.send(JSON.stringify({resume_id, questions}))

// 3. whenever the server pushes a message, print it in the log box
ws.onmessage = (event) => {
    const data = JSON.parse(event.data)
    if (data.done) { ws.close(); return }
    log(`[Q] ${data.question}  [A] ${data.answer}`)
}
```

This runs entirely in the browser — no extension, no wscat, no curl needed.

---

### 3. GET /extension/ws/test (lines 74–77)

```python
@router.get("/ws/test", response_class=HTMLResponse)
def websocket_test_client():
    return _TEST_CLIENT_HTML
```

A normal HTTP GET route that returns the HTML string above. When you open `http://localhost:8000/extension/ws/test` in a browser, you get that page. That's it.

---

### 4. WS /extension/ws/{user_id}/{job_id} (lines 80–132)

This is the actual WebSocket endpoint. Here's the flow step by step:

#### Step 1 — accept the connection
```python
await websocket.accept()
```
The client (browser/extension) initiated a WebSocket handshake. This line completes it. Until `accept()` is called, the connection is pending.

#### Step 2 — receive the questions
```python
raw = await websocket.receive_text()
payload = json.loads(raw)
questions = payload["questions"]
resume_id = payload["resume_id"]
```
`receive_text()` blocks (waits) until the client sends a message. The message is a JSON string, so we parse it manually. If the JSON is malformed or missing keys, we catch that and send back an error.

```python
except (json.JSONDecodeError, KeyError) as exc:
    await websocket.send_json({"error": f"Invalid payload: {exc}"})
    await websocket.close()
    return
```

#### Step 3 — fetch resume and job from DB
```python
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
```
`user_id` and `job_id` come from the URL path (`/ws/{user_id}/{job_id}`). We check that both the resume and job exist AND belong to the correct user — basic ownership check.

We extract the text outside the `with` block so the DB session can close before we start the (slow) Groq calls.

#### Step 4 — generate and push answers one by one
```python
for index, question in enumerate(questions):
    answer = ExtensionService.generate_answer(resume_md, job_desc, question)
    await websocket.send_json({"index": index, "question": question, "answer": answer})
```
For each question:
1. Call Groq (blocks for ~3s)
2. Immediately push the result to the client via `send_json()`

The client receives answer 0 after ~3s, answer 1 after ~6s, etc. The connection stays open between pushes — that's the WebSocket advantage over REST.

#### Step 5 — signal completion
```python
await websocket.send_json({"done": True})
```
Tells the client all questions are answered so it knows to close the connection and stop listening.

#### Step 6 — handle client disconnect
```python
except WebSocketDisconnect:
    pass
```
If the client closes the tab or disconnects mid-session, FastAPI raises `WebSocketDisconnect`. We catch it and do nothing — the function returns cleanly and the server moves on.

---

## Full flow summary

```
Browser/Extension                   Backend (extension_ws.py)
        |                                      |
        |-- WebSocket handshake -------------> |  websocket.accept()
        |                                      |
        |-- {"resume_id":1, questions:[...]} ->|  websocket.receive_text()
        |                                      |  fetch resume + job from DB
        |                                      |  call Groq for Q0 (~3s)
        |<-- {"index":0, "answer":"..."} ------|  websocket.send_json()
        |                                      |  call Groq for Q1 (~3s)
        |<-- {"index":1, "answer":"..."} ------|  websocket.send_json()
        |                                      |
        |<-- {"done": true} -------------------|
        |                                      |
        |-- close ---------------------------> |  WebSocketDisconnect caught
```

---

## Computer Networks connections

### TCP — the foundation everything runs on

WebSocket doesn't replace TCP, it runs on top of it. When `websocket.accept()` is called, a TCP connection has already been established underneath — the browser already did the 3-way handshake (SYN → SYN-ACK → ACK) before FastAPI even saw the request.

```
SYN      →
         ← SYN-ACK
ACK      →
         [TCP connection open]
         [now the HTTP upgrade happens on top of this]
```

WebSocket just borrows this existing TCP connection and keeps it open instead of closing it after one request-response cycle.

---

### HTTP — the upgrade mechanism

The WebSocket connection starts as a completely normal HTTP/1.1 GET request. The client sends special headers asking to switch protocols:

```
GET /extension/ws/1/42 HTTP/1.1
Host: localhost:8000
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
```

The server replies:
```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

`101 Switching Protocols` — you've seen 200, 404, 500. 101 is the one status code that says "we're done with HTTP now, this pipe is yours." After this exchange, HTTP is gone. The TCP socket is now a raw bidirectional channel.

---

### Half-duplex vs Full-duplex

You've studied this in the context of physical communication channels.

- **HTTP (half-duplex in practice):** client sends a request, then waits. Server responds. Turn-taking — only one direction active at a time per connection.
- **WebSocket (full-duplex):** both sides can send at any time simultaneously. The server doesn't need to wait for a request — it can push data whenever it wants.

In this file, the server pushes answers mid-loop without the client asking again. That's full-duplex in action. With HTTP you simply cannot do this — the response is one message and it ends the exchange.

---

### Persistent connection vs connection-per-request

In HTTP/1.0, every request opened a new TCP connection — that's a full 3-way handshake just to fetch one resource. Expensive.

HTTP/1.1 introduced `keep-alive` — reuse the same TCP connection for multiple sequential requests. Better, but still request → response → request → response. The server can never speak first.

WebSocket goes further: one TCP connection, stays open indefinitely, both sides can speak at any time. `receive_text()` in the code is literally just waiting on that open socket for bytes to arrive — same concept as blocking on a socket `recv()` call you'd write in a CN lab.

---

### Port numbers

WebSocket uses the same ports as HTTP:
- `ws://` → port **80** (same as HTTP)
- `wss://` → port **443** (same as HTTPS, with TLS on top)

This is intentional — firewalls and proxies that allow HTTP/HTTPS traffic will also allow WebSocket traffic without any extra configuration. If WebSocket used a new port (say 9000), corporate firewalls would block it by default.

---

### The Sec-WebSocket-Key / Accept handshake

This is a lightweight security check to make sure the server actually understands WebSocket (not just echoing back random HTTP headers).

The client sends a random base64 key. The server must:
1. Concatenate it with a fixed magic string: `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`
2. SHA-1 hash the result
3. Base64 encode that hash
4. Send it back as `Sec-WebSocket-Accept`

The client verifies the response. If it doesn't match, the connection is rejected. You can see SHA-1 and base64 encoding here — both concepts from your networks/security coursework showing up in a real protocol handshake.


#### Why does this exist — what problem is it solving? (optional read)

Imagine a normal web server that knows nothing about WebSocket. A client sends the upgrade request with `Upgrade: websocket`. A dumb server might just echo back whatever headers it received without actually switching to WebSocket mode — and the client would be stuck talking WebSocket to a server that's still speaking HTTP. Nothing would work, and the client would have no way to tell.

The key/accept mechanism forces the server to **prove it processed the request correctly**. A server can't fake the right `Sec-WebSocket-Accept` value unless it actually ran the algorithm. If the value is wrong or missing, the client immediately knows: this server doesn't speak WebSocket, abort.

#### Walking through the algorithm with a real example

**Step 1 — client generates a random key**

The browser picks 16 random bytes and base64 encodes them:
```
Random bytes: 37 2f 8e 1c ... (16 bytes)
Base64 encoded: dGhlIHNhbXBsZSBub25jZQ==
```
This is sent in the request header:
```
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
```

Base64 is just an encoding scheme — it converts binary bytes into printable ASCII characters so they can be safely sent in HTTP headers (which are text). It's not encryption, it doesn't hide anything. You could decode it back to the original bytes instantly.

**Step 2 — server concatenates with the magic string**

The server takes the key and appends a hardcoded string defined in the WebSocket RFC (RFC 6455). This magic string is the same for every WebSocket implementation in the world:
```
dGhlIHNhbXBsZSBub25jZQ==258EAFA5-E914-47DA-95CA-C5AB0DC85B11
```
Why a magic string? It makes the algorithm specific to WebSocket. Without it, any server could accidentally produce the right answer. The magic string ensures only code that explicitly knows about this WebSocket handshake process can generate a valid response.

**Step 3 — SHA-1 hash**

SHA-1 is a hashing algorithm. A hash takes any input and produces a fixed-size output (160 bits / 20 bytes for SHA-1). Same input always gives same output. But you cannot reverse it — given the hash, you can't recover the original input.

```
SHA-1("dGhlIHNhbXBsZSBub25jZQ==258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
= b37a4f2cc0624f1690f64606cf385945b2bec4ea  (hex)
= sy9PfGSmTK/Lbp8Yad8kJg==  (those same bytes in base64)
```

**Step 4 — base64 encode the hash and send it**

The 20-byte SHA-1 result is binary, so base64 encode it again to make it safe for the HTTP header:
```
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

**Step 5 — client verifies**

The browser runs the exact same algorithm on the key it sent. If the server's `Sec-WebSocket-Accept` matches what the browser computed, the handshake succeeds. If not, the browser kills the connection.

#### The full picture

```
Browser                                    Server
   |                                          |
   | Key = base64(random 16 bytes)            |
   |                                          |
   |-- Sec-WebSocket-Key: <Key> -----------> |
   |                                          | combined = Key + MAGIC_STRING
   |                                          | hash     = SHA1(combined)
   |                                          | accept   = base64(hash)
   |                                          |
   |<-- Sec-WebSocket-Accept: <accept> ------ |
   |                                          |
   | runs same algo on Key it sent            |
   | does it match accept? YES → proceed      |
   |                        NO  → abort       |
```

#### Why SHA-1 and not something stronger like SHA-256?

SHA-1 is considered cryptographically weak today — collision attacks exist. But this handshake isn't doing cryptography in the security sense. It's not protecting data, it's just a **proof-of-understanding** check. The goal is confirming the server ran the algorithm, not protecting secrets. SHA-1 is fast and sufficient for that. The actual security of WebSocket data comes from TLS (`wss://`) at the transport layer, not from this handshake.

---

### Summary — which CN layer does what

```
Layer 7 (Application)  →  WebSocket protocol (framing, opcodes, ping/pong)
                           HTTP/1.1 (the upgrade handshake)
                           Your data: JSON messages with questions & answers

Layer 4 (Transport)    →  TCP — reliable, ordered delivery
                           The persistent connection WebSocket lives on

Layer 3 (Network)      →  IP — routing packets between your browser and localhost

Layer 2 (Data Link)    →  Ethernet/Wi-Fi frames carrying those IP packets
```

Everything you built in this file — `accept()`, `receive_text()`, `send_json()` — is FastAPI abstracting away layers 2–4. Under the hood it's the same socket programming (`bind`, `listen`, `accept`, `recv`, `send`) you'd write in C in a CN lab, just wrapped in async Python.
