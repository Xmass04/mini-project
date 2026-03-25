# Testing Phase 4 — Extension Answer Generation

## Prerequisites

Make sure the stack is running before testing:

```bash
./setup.sh
uv run uvicorn app.main:app --reload
```

You also need:
- A resume uploaded and parsed (resume_id exists in DB, `markdown_content` is not empty)
- A job that exists in the DB (job_id)

If starting fresh, run through Phase 2 first:
1. `POST /resumes/upload` — upload a PDF resume
2. `POST /jobs/discover` — scrape some jobs
3. Wait for both tasks to complete, note the `resume_id` and a `job_id`

---

## Option 1 — REST endpoint

### Endpoint
```
POST /extension/answers
```

### Using FastAPI docs (easiest)
Open `http://localhost:8000/docs` in your browser, find `POST /extension/answers`, click **Try it out**, paste the body below, and click **Execute**.

### Using curl
```bash
curl -X POST http://localhost:8000/extension/answers \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": 1,
    "job_id": 1,
    "resume_id": 1,
    "questions": [
      "Why do you want this role?",
      "Describe a technical challenge you solved.",
      "What experience do you have with Python?"
    ]
  }'
```

### Expected response
```json
{
  "answers": [
    {
      "question": "Why do you want this role?",
      "answer": "Based on my experience building..."
    },
    {
      "question": "Describe a technical challenge you solved.",
      "answer": "During my internship at..."
    },
    {
      "question": "What experience do you have with Python?",
      "answer": "I have used Python extensively for..."
    }
  ]
}
```

The response arrives all at once after all Groq calls finish (~3s per question).

---

## Option 2 — WebSocket endpoint (browser test client)

This is the easiest way to see the WebSocket in action without writing any code.

### Step 1
Open this URL in your browser:
```
http://localhost:8000/extension/ws/test
```

You'll see a simple form with fields for `user_id`, `job_id`, `resume_id`, and a textarea for questions.

### Step 2
Fill in:
- `user_id`: `1`
- `job_id`: your job id (e.g. `1`)
- `resume_id`: your resume id (e.g. `1`)
- Questions textarea: one question per line, e.g.
  ```
  Why do you want this role?
  Describe a technical challenge you solved.
  What experience do you have with Python?
  ```

### Step 3
Click **Connect & Send**.

Watch the log box at the bottom — answers appear one by one as each Groq call finishes. This is the key difference from REST: you don't wait for all of them, each answer shows up ~3 seconds apart.

---

## Option 3 — WebSocket via wscat (terminal)

If you prefer the terminal, install wscat:
```bash
npm install -g wscat
```

Connect:
```bash
wscat -c "ws://localhost:8000/extension/ws/1/1"
```

After connecting, paste this and press Enter:
```json
{"resume_id": 1, "questions": ["Why do you want this role?", "Describe a challenge you overcame."]}
```

You'll see answers pushed back one by one:
```
< {"index": 0, "question": "Why do you want this role?", "answer": "..."}
< {"index": 1, "question": "Describe a challenge you overcame.", "answer": "..."}
< {"done": true}
```

---

## Error cases to verify

### Resume not found
```bash
curl -X POST http://localhost:8000/extension/answers \
  -H "Content-Type: application/json" \
  -d '{"user_id": 1, "job_id": 1, "resume_id": 999, "questions": ["test?"]}'
```
Expected: `404 Resume not found.`

### Job not found
```bash
curl -X POST http://localhost:8000/extension/answers \
  -H "Content-Type: application/json" \
  -d '{"user_id": 1, "job_id": 999, "resume_id": 1, "questions": ["test?"]}'
```
Expected: `404 Job not found.`

### Wrong user (resume belongs to different user)
Change `user_id` to `2` while keeping a valid `resume_id` that belongs to user 1.
Expected: `404 Resume not found.`

---

## What to observe

| | REST | WebSocket |
|---|---|---|
| Total time (3 questions) | ~9-12s | ~9-12s (same) |
| When answers appear | All at once at the end | One by one, ~3s apart |
| How to test | curl / `/docs` | Browser test client or wscat |
| Chrome Extension usage | `fetch()` call | `new WebSocket()` + message listener |
