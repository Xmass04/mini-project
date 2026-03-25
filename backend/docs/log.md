# Command Log

| # | Command | Explanation |
|---|---------|-------------|
| 1 | `uv init --no-workspace` | Initializes a new uv-managed Python project, creating `pyproject.toml` |
| 2 | `uv add fastapi uvicorn[standard] sqlmodel psycopg2-binary celery redis python-dotenv groq apify-client pydantic-settings alembic` | Installs all core backend dependencies and locks them in `pyproject.toml` |
| 3 | `mkdir -p app/{api,core,models,services,worker} tests` | Creates the full project directory structure |
| 4 | `chmod +x setup.sh` | Makes the setup script executable |
| 5 | `uv run alembic init alembic` | Initializes Alembic migration framework with config and versions directory |

---

## Phase 1 Complete — Files Created

| File | Purpose |
|------|---------|
| `app/models/models.py` | `User`, `Resume`, `Job` SQLModel tables |
| `app/main.py` | FastAPI entry point + DB init on startup |
| `app/core/config.py` | Settings from `.env` |
| `app/core/db.py` | Engine + session + table creation |
| `docker-compose.yml` | `db`, `redis`, `api`, `worker` containers |
| `Dockerfile` | uv-based image |
| `setup.sh` | One-command team bootstrap |
| `.env.example` | Env var template |
| `alembic/` | DB migrations wired to SQLModel metadata |

---

## Phase 2 Commands

| # | Command | Explanation |
|---|---------|-------------|
| 6 | `uv add docling python-multipart` | Adds Docling (PDF → Markdown) and multipart form support for file uploads |

## Phase 2 Complete — Files Created / Modified

| File | Status | Purpose |
|------|--------|---------|
| `app/services/parsing.py` | Created | `ParsingService` — Docling: PDF bytes → Markdown string |
| `app/services/discovery.py` | Created → Modified | `DiscoveryService` — Apify actor trigger → list of job postings; actor switched to `curious_coder/linkedin-jobs-scraper`, input changed to `urls`, field mapping fixed (`link`, `companyName`, `descriptionText`) |
| `app/worker/celery_app.py` | Created | Celery app initialized with Redis broker/backend |
| `app/worker/tasks.py` | Created → Modified | `parse_resume_task` and `discover_jobs_task`; task updated to accept `search_id`, deduplicate by URL, write `JobSearchResult` links |
| `app/api/resumes.py` | Created | `POST /resumes/upload`, `GET /resumes/{id}` |
| `app/api/jobs.py` | Created → Modified | `POST /jobs/discover` (returns `search_id`), `GET /jobs/` (filterable by `search_id`), `GET /jobs/discover/{task_id}/status` (new) |
| `app/core/config.py` | Modified | Added `APIFY_ACTOR_ID` (`curious_coder/linkedin-jobs-scraper`) and `LLM_MODEL` settings |
| `app/main.py` | Modified | Registered resumes and jobs routers |
| `app/models/models.py` | Modified | Added `JobSearch` and `JobSearchResult` models |

---

## Why These Technology Choices

### Docling over PyMuPDF
PyMuPDF extracts raw text — it dumps characters in reading order but loses structure (tables, sections, bullet points become a flat blob). Docling understands document layout and exports clean Markdown, which gives the LLM much better context when scoring a resume against a job description. The structure (e.g. "Experience", "Skills" headings) matters for Groq/Llama to reason accurately.

### uv over pip / poetry
`uv` is a Rust-based package manager orders of magnitude faster than pip. It handles virtual environments, dependency locking, and running scripts (`uv run`) without manually activating a venv. In 2026 it's the standard for new Python projects. `uv sync` installs everything from `uv.lock` in seconds.

Memory efficiency is another key advantage — uv uses a global package cache and hardlinks packages into each project's venv instead of copying them. Installing the same package across multiple projects costs near-zero extra disk space. pip copies files every time, so three projects with the same dependencies means three full copies on disk. uv avoids that entirely.

### Docker + Docker Compose
PostgreSQL and Redis can't run as Python packages — they're separate processes. Docker Compose lets the whole team spin up `db` and `redis` with one command (`docker-compose up -d db redis`) without installing them natively. It also matches a production-like environment so there are no "works on my machine" issues.

### Celery + Redis
Resume parsing (Docling) and job scraping (Apify) are slow — they can take 10–60 seconds. Running them synchronously in a FastAPI route would block the request and time out. Celery offloads these to background workers; the API returns immediately with a task ID, and the worker processes it async. Redis acts as the message broker (task queue) and result backend.

---

## What `setup.sh` Does

Runs once to bootstrap the environment for any team member:

1. Checks if `uv` is installed — installs it if missing
2. Runs `uv sync` — installs all Python dependencies from `pyproject.toml`
3. Copies `.env.example` → `.env` if no `.env` exists yet
4. Runs `docker-compose up -d db redis` — starts Postgres and Redis containers
5. Runs `uv run alembic upgrade head` — applies DB migrations to create tables

After `setup.sh`, only `uv run uvicorn app.main:app --reload` is needed to start the API.

---

## Errors Encountered

### `ForeignKeyViolation` on `POST /resumes/upload`

**Error:**
```
psycopg2.errors.ForeignKeyViolation: insert or update on table "resume" violates
foreign key constraint "resume_user_id_fkey"
DETAIL: Key (user_id)=(1) is not present in table "user".
```

**Cause:** `Resume.user_id` has a FK constraint → `user.id`. Calling the upload endpoint with `user_id=1` failed because no User row existed in the DB yet — there was no endpoint or mechanism to create one.

**Options considered:**
| Option | Verdict |
|--------|---------|
| Add `POST /users/` endpoint | Works but requires a manual extra step before every test |
| Remove `user_id` FK from models | Loses the user→resume link needed for Phase 3 scoring |
| Proper Supabase auth | Overkill for a local-only tool; separate concern |
| Seed a default user on startup | ✅ Chosen — zero friction, idempotent, reversible |

**Fix:** Added `seed_default_user()` to `app/core/db.py`. Called from `on_startup` in `app/main.py` after `create_db_and_tables()`. Checks if `user.id = 1` exists before inserting — safe to run on every restart.

**Files changed:** `app/core/db.py`, `app/main.py`

---

### Docling OCR overhead on ATS resumes

**Observed:** Parse task taking ~17 seconds with RapidOCR models being downloaded and initialised on every worker start.

**Before (default `DocumentConverter()`, OCR auto mode):**
```
Initializing pipeline for StandardPdfPipeline...
Registered ocr engines: ['auto', 'easyocr', 'ocrmac', 'rapidocr', ...]
Initiating download: .../ch_PP-OCRv4_det_infer.pth   (13.83MB)
Initiating download: .../ch_PP-OCRv4_rec_infer.pth   (25.67MB)
Auto OCR model selected rapidocr with torch.
Finished converting document resume.pdf in 17.43 sec.
Task parse_resume_task succeeded in 17.56s
```

**After (`do_ocr=False` via `PdfPipelineOptions`):**
```
detected formats: [<InputFormat.PDF: 'pdf'>]
Going to convert document batch...
Processing document resume.pdf
Finished converting document resume.pdf in 2.44 sec.
Task parse_resume_task succeeded in 2.46s
```

**Why:** OCR is for scanned/image PDFs — it converts a visual page into text. ATS-friendly resumes already have text embedded natively; running OCR on them downloads ~40MB of models and wastes ~15 seconds per parse for zero benefit.

**Fix:** `PdfPipelineOptions(do_ocr=False)` passed into `DocumentConverter` via `PdfFormatOption`. Parse time dropped from **17.5s → 2.4s**.

**Files changed:** `app/services/parsing.py`

---

### Apify actor free trial expired on `POST /jobs/discover`

**Status:** ✅ Resolved

**Observed:** `discover_jobs_task` retried 3 times then gave up with:
```
ApifyApiError: You must rent a paid Actor in order to run it after its free trial
has expired. To rent this Actor, go to https://console.apify.com/actors/BHzefUZlZRKWxkTck
```

**When:** Called `POST /jobs/discover` with `{"user_id": 1, "title": "software engineer intern", "location": "kochi,india", "limit": 5}`.

**Cause:** The Apify actor `bebity/linkedin-jobs-scraper` has a free trial that had expired. Apify's paid actors require an active rental to run beyond the trial period.

**Fix:** Switched `APIFY_ACTOR_ID` in `app/core/config.py` to `curious_coder/linkedin-jobs-scraper`, a free actor available within Apify's monthly credits. Also updated `DiscoveryService.discover()` to build a LinkedIn job search URL and pass it as `urls` (a plain string list), which is the input format this actor expects.

**Files changed:** `app/core/config.py`, `app/services/discovery.py`

---

### Wrong input field — `Field input.urls is required`

**Status:** ✅ Resolved

**Observed:** After switching to `curious_coder/linkedin-jobs-scraper`, the task kept retrying with:
```
ApifyApiError: Input is not valid: Field input.urls is required
```

**Cause:** The original `DiscoveryService` was passing `queries` as the run input, which was the schema for the old `bebity` actor. The new actor requires `urls` — a list of LinkedIn job search page URLs.

**Fix:** Updated `app/services/discovery.py` to construct a LinkedIn search URL from `title` and `location` using `urllib.parse.quote_plus`, and pass it as `urls: [search_url]`.

**Files changed:** `app/services/discovery.py`

---

### Job `url` field empty in `GET /jobs/` response

**Status:** ✅ Resolved

**Observed:** Jobs were scraped and saved successfully but `url` was always `""` in the API response.

**Cause:** The field mapping in `DiscoveryService` was calling `item.get("url", item.get("jobUrl", ""))`. The `curious_coder/linkedin-jobs-scraper` actor does not return a field named `url` or `jobUrl` — the job link is under the key `link`.

**Discovered by:** Adding a temporary `logging.warning("RAW ITEM KEYS: %s", ...)` log to inspect the dataset item returned by the actor. Output confirmed the correct field names: `link` (job URL), `companyName`, `descriptionText`.

**Fix:** Updated the field mapping in `DiscoveryService`:
- `url` → `item.get("link", "")`
- `company` → `item.get("companyName", "")`
- `description` → `item.get("descriptionText", "")`

**Files changed:** `app/services/discovery.py`

---

## Phase 3 — Task Status, Search Sessions & Deduplication

### Feature: Task status endpoint, search session tracking, job deduplication

**Problem:**
- `POST /jobs/discover` returned `{task_id, status}` but there was no way to poll whether the task had finished
- Jobs had no association to the search that produced them — couldn't filter `GET /jobs/` by a specific search
- Running discover twice with the same query inserted duplicate `Job` rows for the same URL

**Design decision — link table vs `search_id` on `Job`:**

Adding `search_id` directly to `Job` was considered (simpler, no new tables). Rejected because deduplication conflicts with it: if a job URL already exists, you can either update its `search_id` (losing the original search link) or skip it (losing the link to the new search). A many-to-many link table solves both.

**New models:**
- `JobSearch` — one row per discover call (`id, user_id, title, location, task_id, created_at`)
- `JobSearchResult` — link table with composite PK (`search_id, job_id`); a job can belong to many searches

**No Alembic migration needed:** project uses `SQLModel.metadata.create_all(engine)` on startup (`app/core/db.py`), which auto-creates new tables. Alembic is for production incremental migrations; `create_all` is sufficient for local dev.

**API changes:**
- `POST /jobs/discover` — creates `JobSearch` in DB before enqueue, returns `{task_id, search_id, status: "discovering"}`
- `GET /jobs/discover/{task_id}/status` — new; queries `celery_app.AsyncResult(task_id).state`, returns `{task_id, state}` (PENDING / STARTED / RETRY / FAILURE / SUCCESS)
- `GET /jobs/` — gained optional `search_id` query param; joins through `JobSearchResult` when provided

**Worker changes (`discover_jobs_task`):**
- Accepts `search_id` param
- For each scraped job: checks if `(user_id, url)` already exists → reuses existing job row if so, inserts new one if not
- Writes `JobSearchResult(search_id, job_id)` for every job regardless (new or reused)
- Uses `session.merge()` for the link row so it's idempotent on retry

**Files changed:** `app/models/models.py`, `app/api/jobs.py`, `app/worker/tasks.py`

---

## Phase 3 Complete — ReasoningService + Job Scoring

### What was built

Groq/Llama-powered resume-to-job scoring. Each job is scored 0–10 against the user's parsed resume with a fit reasoning string, stored on the `Job` row.

### Files Created / Modified

| File | Status | Purpose |
|------|--------|---------|
| `app/services/reasoning.py` | Created | `ReasoningService.score(resume_md, job_desc)` — calls Groq with truncated inputs, validates output with Pydantic, returns `{score: int, fit_reasoning: str}` |
| `app/worker/tasks.py` | Modified | Added `score_jobs_task` (max_retries=10) and `_parse_retry_after()` helper; serially scores job list with 8s sleep between calls; catches `groq.RateLimitError` separately to use actual retry-after wait |
| `app/api/jobs.py` | Modified | Added `POST /jobs/{job_id}/score` (single), `GET /jobs/score/{task_id}/status`, `POST /jobs/score/batch` (scores all pending jobs for a user/search) |
| `app/core/config.py` | Modified | Added `SCORING_MODEL = llama-3.1-8b-instant` (500K TPD, separate from `LLM_MODEL` used in Phase 4) |
| `app/main.py` | Modified | Bumped API version to `3.0.0` |

### Key design decisions

**Model split:** `llama-3.1-8b-instant` (500K TPD) for scoring vs `llama-3.3-70b-versatile` (100K TPD) for answer generation. Scoring runs on every job in bulk — 500K TPD headroom prevents hitting the daily cap before Phase 4 answer generation gets any tokens.

**Input truncation:** `resume_markdown[:6000]` + `job_description[:4000]` keeps each call to ~1500 tokens, enabling ~8 calls/min under the 12K TPM free-tier limit.

**Rate-limit retry strategy:** `score_jobs_task` has `max_retries=10`. On `groq.RateLimitError`, `_parse_retry_after()` reads the actual wait from `response.headers["retry-after"]` (with regex fallback on the message string, last resort 300s). This avoids blind fixed delays when Groq specifies the exact window.

**Serial scoring with sleep:** Jobs are scored one at a time with `time.sleep(8)` between calls (not concurrent) to stay under TPM. `session.commit()` after each job so partial progress survives a task retry — idempotent because `job.status = "scored"` is set before commit.

**Batch endpoint:** `POST /jobs/score/batch` queries all `status = "pending"` jobs for a user (optionally filtered by `search_id`) and dispatches a single `score_jobs_task` with the full list, so the caller doesn't need to loop.

---

## Phase 4 Complete — Extension Answer Generation

### What was built

Groq/Llama-powered application question answering for the Chrome Extension. Given a list of questions scraped from a job application form, the backend generates tailored answers using the user's full resume and the job description. Two implementations were built — REST and WebSocket — so both approaches can be compared and tested.

### Files Created / Modified

| File | Status | Purpose |
|------|--------|---------|
| `app/services/extension.py` | Created | `ExtensionService.generate_answer(resume_md, job_desc, question)` — calls Groq with full resume (no truncation), returns answer string |
| `app/api/extension_rest.py` | Created | `POST /extension/answers` — REST version; loops through questions, returns all answers as a JSON list |
| `app/api/extension_ws.py` | Created | `ws://.../extension/ws/{user_id}/{job_id}` — WebSocket version; pushes each answer as it's ready; includes browser test client at `GET /extension/ws/test` |
| `app/main.py` | Modified | Registered both extension routers, bumped API version to `4.0.0` |
| `docs/phase4-websocket-vs-rest.md` | Created | Full explanation of REST vs WebSocket trade-offs, CN theory, and code comparison |

### Key design decisions

**Two implementations:** Both REST and WebSocket are registered simultaneously under the same `/extension` prefix. REST at `POST /extension/answers`, WebSocket at `ws://.../extension/ws/{user_id}/{job_id}`. This allows direct comparison without switching branches.

**No input truncation:** Unlike Phase 3 scoring, answer generation uses the full `resume.markdown_content`. The full resume context is required to generate specific, grounded answers (e.g. referencing actual projects). Truncation would cause the model to miss relevant experience.

**Model:** `LLM_MODEL = llama-3.3-70b-versatile` (100K TPD). Answer generation is user-triggered (one job at a time), not bulk — 100K TPD is sufficient.

**REST vs WebSocket trade-off:** REST returns all answers after all Groq calls finish. WebSocket pushes each answer individually as each call completes. Total latency is identical — the difference is UX perception (progressive fill vs all-at-once). REST is recommended for the Chrome Extension due to simpler `fetch()` integration.

**Browser test client:** `GET /extension/ws/test` serves a plain HTML page with a form to enter questions and see WebSocket messages arrive in real time. Useful for demonstrating the progressive answer flow without needing the Chrome Extension.
