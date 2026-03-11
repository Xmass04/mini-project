## System Design of ApplyEase

A privacy-first Chrome extension that automates job applications using local AI models. Here's a comprehensive breakdown of its architecture and how it works:

---

## **Architecture Overview**

Our plan is a **three-tier system**:

```
┌─────────────────────────────────────────────────────────────┐
│  CHROME EXTENSION (Frontend - User Interaction)             │
│  • Popup UI                                                  │
│  • Content Script (Page Injection)                           │
│  • Background Service Worker                                │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  REACT WEB APP (Dashboard)                                  │
│  • Login/Signup                                              │
│  • Resume Builder                                            │
│  • Job Tracker (Kanban Board)                                │
│  • Cover Letter Generator                                    │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  FASTAPI BACKEND (:8000)                                    │
│  • User Auth (JWT)                                           │
│  • Resume Embedding & Matching                               │
│  • PDF Generation                                            │
│  • Local LLM Integration                                     │
│  • PostgreSQL + pgvector (Vector DB)                         │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  LOCAL AI MODELS                                            │
│  • Ollama (Llama 3.1, etc.)                                 │
│  • LM Studio / OpenAI-compatible                             │
└─────────────────────────────────────────────────────────────┘
```

---

## **Component Breakdown**

### **1. Chrome Extension** (Manifest v3)

```json name=manifest.json url=https://github.com/sainikhil1605/ApplyEase/blob/main/manifest.json
{
    "name":"Apply Ease",
    "version":"1.0",
    "description":"An Extension to apply jobs with ease",
    "manifest_version":3,
    "action":{
        "default_popup":"popup/popup.html",
        "default_title":"Apple Ease"
    },
    "icons":{"16": "popup/icon2.png","48": "popup/icon2.png","128": "popup/icon2.png"},
    "background": {"service_worker": "background.js"},
    "permissions":["scripting", "activeTab","storage"],
    "host_permissions":["<all_urls>"],
    "content_scripts": [{
        "matches": ["<all_urls>"],
        "run_at":"document_end",
        "all_frames": true,
        "js": ["contentscript.js"]
    }],
    "externally_connectable": {"matches": ["http://localhost:3000/*"]}
}
```

#### **Background Service Worker** (`background.js`)
- Handles Chrome runtime messages (token fetch/store)
- Manages tab operations (create, close, navigate)
- Acts as a bridge between the content script and popup

```javascript name=background.js url=https://github.com/sainikhil1605/ApplyEase/blob/main/background.js#L1-L30
const fields = {
  name: "Nikhil",
  phone: "1234567890",
  email: "nikhil@gmail.com",
  location: "Overland Park,KS",
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "fetchToken") {
    chrome.storage.local.get("token", (data) => {
      sendResponse(data.token || null);
    });
  }
  if (message.action === "AddToken") {
    chrome.storage.local.set({ token: message.token });
  }
  if (message.action === "closeTab") {
    chrome.tabs.remove(sender.tab.id);
  }
  if (message.action === "newTab") {
    chrome.tabs.create({ url: message.url, active: true });
  }
});
```

#### **Content Script** (`contentscript.js`)
- Injects into **all web pages** at document end
- **Extracts job descriptions** from popular job boards (Indeed, LinkedIn, Workday, etc.)
- **Computes resume match score** in real-time
- **Auto-fills form fields** (name, email, phone, resume, links)
- **Shows floating match widget** on job postings

```javascript name=contentscript.js url=https://github.com/sainikhil1605/ApplyEase/blob/main/contentscript.js#L1-L50
const API_BASE = "http://localhost:8000";

const getToken = () =>
  new Promise((resolve) =>
    chrome.storage.local.get("token", (d) => resolve(d?.token || null))
  );

const fetchUserDetails = async (token) => {
  const headers = { Authorization: `Bearer ${token}` };
  const resUser = await fetch(`${API_BASE}/user`, { headers });
  const data = await resUser.json();
  
  // Get resume as PDF or text fallback
  const resPdf = await fetch(`${API_BASE}/resume_pdf`, { headers });
  if (resPdf.ok) {
    const blob = await resPdf.blob();
    return { ...data.user, resume: new File([blob], "resume.pdf") };
  }
};

const setValue = (el, val) => {
  el.focus();
  el.value = val;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.blur();
};
```

---

### **2. React Frontend** (Port 3000)

Located in `/frontend/`:

**Features:**
- **Login/Signup** → JWT stored in localStorage & broadcast to extension
- **Resume Builder** → Structured sections (title, summary, skills, experiences, education)
- **Resume Upload** → PDF parsed and embedded into pgvector
- **Job Tracker** → Kanban board (Saved → Applied → Interview → Offer → Rejected)
- **Cover Letter Generator** → Uses local LLM or templates
- **Tailored Resume Generator** → Creates PDF matching job description

---

### **3. FastAPI Backend** (Port 8000)

**Core Responsibilities:**

#### **Authentication & User Profile**
```
POST /signup          → Create user, return JWT token
POST /login           → Auth with email/password
PATCH /user (Bearer)  → Update profile + resume upload
GET /user (Bearer)    → Fetch user details
```

#### **Resume Management**
```
GET /resume (Bearer)           → Get raw resume text
GET /resume_pdf (Bearer)       → Generate/retrieve PDF
POST /resume_sections (Bearer) → Save structured resume data
GET /resume_sections (Bearer)  → Fetch resume sections
```

#### **Resume-to-Job Matching** (Core Feature)
```
POST /match (Bearer)
Body: { jobDescription }
Response: { percent, matchingWords, missingWords, score }
```

**How it works:**
1. Uses **SentenceTransformer (`all-MiniLM-L6-v2`)** to create embeddings
2. Stores resume embeddings in **PostgreSQL with pgvector** (384-dim vectors)
3. Computes **cosine similarity** between resume embedding and job description
4. Extracts **tech keywords** (Python, AWS, React, etc.) for diagnostic display
5. Returns match percentage & highlighted keywords

#### **Tailored Resume Generation**
```
POST /generate_tailored_resume (Bearer)
Body: { job_description }
Response: { id, download_url }
```
- Creates templated PDF prioritizing relevant experiences
- Saved in `tailored_resumes` table for history

#### **Cover Letter Generation**
```
POST /cover_letters/generate (Bearer)
Body: { company, title, job_description, use_llm }
Response: PDF stream
```
- Uses local LLM (Ollama/LM Studio) to generate tailored letters
- Supports template-only mode without LLM

#### **Job Tracker**
```
GET /jobs (Bearer)              → List all tracked jobs
POST /jobs (Bearer)             → Create job entry
PATCH /jobs/{id} (Bearer)       → Update status
DELETE /jobs/{id} (Bearer)      → Remove job
GET /jobs/stats (Bearer)        → Aggregate statistics
```

#### **Custom Answer Generation**
```
POST /custom-answer (Bearer)
Body: { jobDescription, applicationQuestion }
Response: { answer }
```
- Uses local LLM to generate tailored responses
- No API calls = privacy-first

---

## **Database Schema**

**PostgreSQL with pgvector extension:**

```sql
-- Users table
users(id text pk, first_name, last_name, email unique, 
      password_hash, phone, location, urls jsonb, 
      eeo jsonb, created_at, updated_at)

-- Resume storage & embeddings
resumes(user_id text pk, resume_text text, 
        embedding vector(384),  -- SentenceTransformer output
        resume_keywords text[], 
        summary text, title text, 
        experiences jsonb, education jsonb, skills text[],
        resume_blob bytea, resume_mime text, 
        resume_filename text, updated_at)

-- Tailored resume history
tailored_resumes(id text pk, user_id, job_description, 
                 resume_text, resume_blob, resume_mime, 
                 resume_filename, created_at)

-- Cover letter history
cover_letters(id text pk, user_id, job_id, company, title, 
              letter_text, letter_blob, letter_mime, 
              filename, created_at)

-- Job tracking
job_applications(id text pk, user_id, company, title, location, 
                 source, url, status, notes, jd_text, 
                 next_action_date, created_at, updated_at)
```

---

## **Data Flow: How It Works**

### **Flow 1: Job Application with Auto-Fill**

```
1. User signs up/logs in on React app (localhost:3000)
   ↓ JWT stored in localStorage
   ↓ Extension reads token from localStorage via message

2. User uploads resume PDF on React dashboard
   ↓ Backend: PATCH /user → parses PDF, creates embedding
   ↓ Stores in PostgreSQL resumes table with pgvector

3. User visits job posting (LinkedIn, Indeed, etc.)
   ↓ Content script injects on page
   ↓ Extracts job description from page selectors
   ↓ Calls POST /match with JD
   ↓ Backend: cosine similarity(resume_embedding, jd_embedding)
   ↓ Returns match % + keywords
   ↓ Floating widget shows "Resume Match: 85%"

4. User clicks "Auto Fill" in popup
   ↓ Content script fills: first_name, last_name, email, phone, location
   ↓ Fetches resume PDF from GET /resume_pdf
   ↓ Finds file upload field, uploads resume
   ↓ Adds "Fill" buttons next to text areas

5. User clicks "Fill" on application question
   ↓ Content script sends: { jobDescription, applicationQuestion }
   ↓ Backend: POST /custom-answer → calls local LLM
   ↓ Ollama/LM Studio generates tailored response locally
   ↓ Response injected into text field
   ↓ No external API calls = privacy preserved

6. User submits application
   ↓ Content script auto-tracks: POST /jobs with status="applied"
   ↓ Job appears in Job Tracker board
```

### **Flow 2: Resume Builder & Tailored CV**

```
1. User builds resume in React dashboard
   ↓ Enters: title, summary, experiences, education, skills
   ↓ Clicks "Save"
   ↓ POST /resume_sections → stored in PostgreSQL

2. User provides job description
   ↓ Clicks "Generate Tailored CV"
   ↓ POST /generate_tailored_resume
   ↓ Backend: prioritizes relevant experiences from resume data
   ↓ Creates templated PDF with matching keywords highlighted
   ↓ Saved in tailored_resumes table
   ↓ PDF sent to user for download

3. User can generate Cover Letter
   ↓ POST /cover_letters/generate
   ↓ If use_llm=true: calls local LLM
   ↓ Otherwise: uses template
   ↓ PDF generated and saved in cover_letters table
```

### **Flow 3: Job Tracker**

```
1. Jobs auto-tracked from applications
2. User can manually add jobs with status
3. Kanban board: drag & drop between columns
   - Saved → Applied → Interview → Offer → Rejected
4. Each card shows company, title, quick actions
5. Status updates persisted to database
```

---

## **Key Technologies**

| Component | Stack |
|-----------|-------|
| **Backend** | FastAPI, Python 3.9+, PostgreSQL, pgvector |
| **Frontend** | React, JavaScript, localStorage |
| **Extension** | Chrome Manifest v3, JavaScript, Content Scripts |
| **AI/ML** | SentenceTransformer (all-MiniLM-L6-v2), Ollama, LM Studio |
| **Auth** | JWT (Bearer tokens) |
| **Databases** | PostgreSQL with pgvector for semantic search |
| **PDF Generation** | Python library (reportlab or similar) |

---

## **Privacy & Security**

✅ **No API keys required** - local LLM integration  
✅ **Resume embeddings stored locally** - pgvector in your database  
✅ **JWT tokens** - secure auth without passwords stored in extension  
✅ **CORS enabled** - secure communication between layers  
✅ **Form injection only** - content script only modifies pages user visits  

---

This is a sophisticated **full-stack application** combining Chrome extension development, machine learning, and web technologies to streamline job applications while maintaining privacy! 🚀