# Ashh — Document-Grounded AI Chatbot

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Python](https://img.shields.io/badge/Python-3.11%20%7C%203.12%20%7C%203.13-blue?logo=python&logoColor=white)](https://python.org)
[![ChromaDB](https://img.shields.io/badge/VectorDB-ChromaDB-orange)](https://chromadb.com)
[![Anthropic Claude](https://img.shields.io/badge/LLM-Anthropic%20Claude%203.5-purple?logo=anthropic&logoColor=white)](https://anthropic.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Ashh** is an end-to-end, document-grounded AI chatbot that runs locally and serves a modern, Claude-style interface in Google Chrome at `http://localhost:8000`. Ashh answers questions strictly using your uploaded PDF documents, providing interactive, numbered citations (`[1]`, `[2]`) that link directly to source passages.

Ashh features a **Zero-Crash Offline Extractive Fallback mode**, allowing complete ingestion, vector retrieval, and citation browsing on-device even without an Anthropic API key.

---

## Table of Contents
- [Product Overview](#product-overview)
- [Architecture & Workflow](#architecture--workflow)
- [Tools & Tech Stack Used](#tools--tech-stack-used)
- [Real-World Use Cases & Applications](#real-world-use-cases--applications)
- [Sample Documents Included](#sample-documents-included)
- [Quickstart & Local Run](#quickstart--local-run)
- [Switching to Offline Mode](#switching-to-offline-mode)
- [Deployment Options](#deployment-options)
  - [1. Sharing Live via Cloudflare Tunnel & Bitly](#1-sharing-live-via-cloudflare-tunnel--bitly)
  - [2. Deploying with Docker](#2-deploying-with-docker)
  - [3. Cloud Deployment (Render / Railway / Fly.io)](#3-cloud-deployment-render--railway--flyio)
- [Testing Suite](#testing-suite)
- [Project Structure](#project-structure)

---

## Product Overview

Unlike standard conversational chatbots that answer from general pre-trained weights (which often produce hallucinations), Ashh anchors every answer in verified PDF excerpts. 

### Key Highlights:
- **Interactive Source Citations:** Every factual sentence has clickable bracketed markers (`[1]`, `[2]`). Clicking any chip opens a modal showing the exact document title, page number, and full source text.
- **Claude-Style Aesthetic:** Classic serif typography (`Newsreader`), clean modern body (`Plus Jakarta Sans`), generous whitespace, subtle borders, and smooth 150ms transitions.
- **Persistent Storage:** SQLite (`./data/ashh.db`) tracks conversations, feedback (thumbs up/down), and documents. ChromaDB (`./data/chroma`) stores dense vector embeddings on disk.
- **Deduplication & Page Handling:** Uploads are deduplicated via SHA-256 content hashes. Empty or scanned pages are reported gracefully without crashing.
- **Streaming UI:** Real-time token-by-token answer streaming over Server-Sent Events (SSE) with typing cursor and mid-stream stop capability.

---

## Architecture & Workflow

```text
+-----------------------------------------------------------------------------------------+
|                                  Google Chrome Frontend                                 |
|               (Vanilla HTML5, CSS3, ES6 JavaScript, Marked, DOMPurify)                  |
|    - Server-Sent Events (SSE) live streaming with pulsating cursor                     |
|    - Interactive citation chips [1] opening full chunk verification modal               |
|    - Drag-and-drop PDF shelf with page counts and delete confirmations                 |
|    - Chat history categorized by Today / Yesterday / Earlier with search filtering      |
+-------------------------------------------+---------------------------------------------+
                                            | HTTP REST & SSE Stream
                                            v
+-----------------------------------------------------------------------------------------+
|                                    FastAPI Backend                                      |
|                                    (Python 3.11+)                                       |
+---------------------+---------------------+-----------------------+---------------------+
|  Document Ingest    |  Vector Retrieval   |    LLM Generation     |  Metadata Storage   |
|   - pypdf parsing   |   - ChromaDB store  |   - Anthropic Claude  |   - SQLite (ashh.db)|
|   - Page tracking   |   - all-MiniLM-L6-v2|     3.5 Sonnet Stream |   - Chats & Messages|
|   - Recursive Split |   - Scoped filtering|   - Offline Extractive|   - Thumbs Feedback |
|     (800c / 120ovl) |   - Top-K ranking   |     Fallback Pipeline |   - Document records|
+---------------------+---------------------+-----------------------+---------------------+
```

### End-to-End Processing Flow:
1. **Ingestion & Chunking (`app/ingest.py`):** When a PDF is uploaded, `pypdf` extracts text page-by-page. Text is chunked with `RecursiveCharacterTextSplitter` into ~800-character segments with 120-character overlap while preserving page numbers.
2. **Local Vector Embeddings (`app/retrieval.py`):** Chunks are transformed into 384-dimensional dense vectors using an on-device ONNX embedding model (`all-MiniLM-L6-v2`) and indexed in ChromaDB.
3. **Retrieval & Context Injection:** User queries are vectorized and compared against indexed chunks via cosine similarity to retrieve the top-k passages (default 5, adjustable 1–10). Document scoping filters allow restricting searches to selected files.
4. **Answer Generation & Verification (`app/llm.py`):** Context is supplied with numbered blocks `[1]`, `[2]`. Claude synthesizes an answer or Ashh extracts the key quotes in offline mode. The UI transforms `[1]` markers into interactive clickable chips.

---

## Tools & Tech Stack Used

| Component | Technology | Purpose & Implementation Details |
|---|---|---|
| **Backend Framework** | `FastAPI` (0.115+) | High-performance asynchronous API, routing, static mounting, and SSE streaming. |
| **ASGI Web Server** | `Uvicorn` (standard) | Production-grade ASGI server handling asynchronous event loops and streaming HTTP. |
| **PDF Extraction** | `pypdf` (6.20+) | Page-by-page text extraction, page numbering preservation, and empty page detection. |
| **Text Chunking** | `langchain-text-splitters` | `RecursiveCharacterTextSplitter` splitting on paragraph and sentence boundaries. |
| **Vector Database** | `ChromaDB` (0.5+) | Persistent vector database stored on disk in `./data/chroma`. |
| **Embeddings** | `ONNX all-MiniLM-L6-v2` | On-device sentence transformer embeddings (no third-party embedding API key required). |
| **LLM Synthesis** | `anthropic` SDK | Official SDK streaming Claude 3.5 Sonnet (`claude-3-5-sonnet-20241022`). |
| **Metadata Database** | `SQLite3` (Standard Lib) | Zero-setup SQL database storing chats, messages, citations, and feedback in `./data/ashh.db`. |
| **Data Validation** | `Pydantic` v2 & `pydantic-settings` | Schema validation and `.env` settings management. |
| **Frontend UI** | Vanilla HTML5 / CSS3 / ES6 JS | Zero build-step single-page application served directly from `/static`. |
| **Markdown & Security** | `marked` & `DOMPurify` (cdnjs) | Safe client-side Markdown rendering and XSS sanitization. |
| **Testing** | `pytest` & `httpx` | Full automated test suite for ingestion, retrieval, streaming, and endpoints. |

---

## Real-World Use Cases & Applications

- **Legal Teams & Paralegals:** Reviewing 100-page contracts, discovery transcripts, or NDAs. Clicks on citation `[1]` to verify clauses directly against source pages in seconds.
- **Financial Analysts:** Ingesting 10-K filings, annual audits, and investor reports. Verifies earnings figures and risk disclosures with source-backed evidence.
- **Researchers & Academics:** Querying whitepapers, clinical literature, or textbooks without hallucinated citations.
- **Corporate HR & Operations:** Querying internal company handbooks, travel policies, and health insurance guidelines.
- **Software Developers & DevOps:** Grounding queries in architectural RFCs, API specifications, and security policies.

---

## Sample Documents Included

The repository includes a standalone script (`scripts/generate_sample_pdf.py`) that generates test PDFs with zero external C dependencies:
1. **`data/sample_employee_handbook.pdf`**: Company policies, working hours, 25 PTO days, $1,200 wellness stipend, and laptop encryption policies.
2. **`data/sample_research_paper.pdf`**: Multi-page technical paper on RAG architectures, vector space manifolds, and citation grounding.

To regenerate them at any time:
```bash
python scripts/generate_sample_pdf.py
```

---

## Quickstart & Local Run

### 1. Prerequisites
- Python 3.11+
- Google Chrome (or modern browser)

### 2. Setup Virtual Environment
```bash
# Clone the repository
git clone https://github.com/aryanpalla198/ashh.git
cd ashh

# Create and activate virtual environment
python -m venv .venv

# On Windows:
.venv\Scripts\activate
# On Linux / macOS:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Edit `.env` (optional):
```env
# Add Anthropic Claude API Key (leave empty for Offline Extractive Mode)
ANTHROPIC_API_KEY=your_key_here

# Model name
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# Chunking & Top-K settings
CHUNK_SIZE=800
CHUNK_OVERLAP=120
TOP_K=5
```

### 4. Launch Ashh

#### On Windows:
Double-click or run:
```cmd
run.bat
```

#### On Linux / macOS:
```bash
chmod +x run.sh
./run.sh
```

Then open Google Chrome at:
**`http://localhost:8000`**

---

## Switching to Offline Mode

Ashh is designed to never crash if an API key is omitted:
1. In `.env`, leave `ANTHROPIC_API_KEY=` blank.
2. Restart the app.
3. Ashh will automatically switch to **Offline Extractive Mode**:
   - PDF ingestion, vector indexing, and semantic search work 100% on your local machine.
   - Ashh returns the most relevant verbatim passages with interactive citation chips `[1]`, `[2]`.

---

## Deployment Options

### 1. Sharing Live via Cloudflare Tunnel & Bitly
To share your running Ashh instance with colleagues using a short link:

```powershell
# 1. Start a temporary public tunnel to localhost:8000
cloudflared tunnel --url http://localhost:8000

# 2. Copy the generated URL (e.g., https://random-name.trycloudflare.com)
# 3. Paste into bitly.com to generate a short link (e.g., bit.ly/ashh-demo)
```

### 2. Deploying with Docker
A [`Dockerfile`](file:///C:/Users/aryan/.gemini/antigravity/scratch/ashh/Dockerfile) is provided:
```bash
# Build Docker image
docker build -t ashh .

# Run container
docker run -p 8000:8000 ashh
```

### 3. Cloud Deployment (Render / Railway / Fly.io)
- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Environment Variables:** Set `ANTHROPIC_API_KEY` (optional) and `TOP_K=5`.

---

## Testing Suite

Run the full automated test suite:
```bash
pytest tests/ -v
```

All 9 core tests verify:
- PDF page extraction and chunk metadata preservation.
- SHA-256 deduplication on identical uploads.
- Rejection of invalid non-PDF and >25MB files.
- Graceful handling of empty or scanned pages.
- Scoped vector retrieval filtering.
- Chat lifecycle (creation, renaming, deletion).
- SSE token streaming in offline mode.
- System health checks and user feedback recording.

---

## Project Structure

```text
ashh/
  ├── app/
  │   ├── main.py            # FastAPI routes, SSE streaming, static mounting
  │   ├── config.py          # Settings from .env using Pydantic Settings
  │   ├── ingest.py          # PDF extraction, chunking, ChromaDB vector indexing
  │   ├── retrieval.py       # Query vector retrieval, top-k search, prompt context
  │   ├── llm.py             # Prompt builder, Claude streaming & offline fallback
  │   ├── storage.py         # SQLite access layer (documents, chats, messages)
  │   └── schemas.py         # Pydantic data models
  ├── static/
  │   ├── index.html         # Claude-style responsive interface
  │   ├── styles.css         # Warm neutral palette, editorial serif typography
  │   └── app.js             # Client state manager, SSE parser, modals, citations
  ├── tests/
  │   ├── test_ingest.py     # Ingestion, deduplication & vector filtering tests
  │   └── test_api.py        # REST endpoints, upload validation & SSE stream tests
  ├── scripts/
  │   └── generate_sample_pdf.py  # Pure Python sample PDF generator
  ├── data/                  # Runtime SQLite DB (ashh.db) & Chroma store (chroma/)
  ├── .env.example           # Example configuration file
  ├── requirements.txt       # Dependencies
  ├── Dockerfile             # Production container definition
  ├── run.sh                 # POSIX launch script
  ├── run.bat                # Windows launch script
  └── README.md              # Comprehensive documentation
```

---

## License

MIT License. Designed with classic typography and local document privacy in mind.
