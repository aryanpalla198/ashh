import json
import uuid
import asyncio
from pathlib import Path
from typing import List, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse

from app.config import settings, PROJECT_ROOT
from app import storage
from app import ingest
from app import retrieval
from app import llm
from app.schemas import (
    DocumentMetadata,
    DocumentUploadResponse,
    ChatCreate,
    ChatUpdate,
    ChatResponse,
    MessageCreate,
    MessageResponse,
    FeedbackRequest,
    ChunkDetailResponse,
    HealthResponse,
    CitationItem
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure SQLite database and ChromaDB collection exist
    storage.init_db()
    ingest.get_collection()
    yield
    # Shutdown

app = FastAPI(
    title="Ashh - Document Grounded AI Chatbot",
    description="A polished document-grounded AI assistant running locally.",
    version="1.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------------------------------------------
# Document Endpoints
# -------------------------------------------------------------

@app.post("/api/documents", response_model=DocumentUploadResponse)
async def upload_documents(files: List[UploadFile] = File(...)):
    """
    Accepts one or more PDFs. Validates file types and sizes.
    Ingests and indexes them in ChromaDB and SQLite.
    """
    if not files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No files were provided for upload."
        )

    uploaded_docs: List[DocumentMetadata] = []
    skipped_empty_pages_map = {}
    duplicates_count = 0

    for file in files:
        filename = file.filename or "document.pdf"
        if not filename.lower().endswith(".pdf"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid file type for '{filename}'. Ashh only accepts PDF files."
            )

        # Read file bytes
        content = await file.read()
        if len(content) > settings.max_file_size_bytes:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File '{filename}' exceeds maximum allowable size of 25 MB."
            )
        if len(content) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File '{filename}' is empty."
            )

        try:
            doc_meta, skipped_pages, is_dup = ingest.ingest_pdf(content, filename)
            uploaded_docs.append(doc_meta)
            if skipped_pages:
                skipped_empty_pages_map[doc_meta.name] = skipped_pages
            if is_dup:
                duplicates_count += 1
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to process '{filename}': {str(e)}"
            )

    msg = f"Successfully processed {len(uploaded_docs)} document(s)."
    if duplicates_count > 0:
        msg += f" ({duplicates_count} already existed and were deduplicated)"

    return DocumentUploadResponse(
        documents=uploaded_docs,
        skipped_empty_pages=skipped_empty_pages_map,
        message=msg
    )

@app.get("/api/documents", response_model=List[DocumentMetadata])
def list_documents():
    """Lists all uploaded documents."""
    docs = storage.list_documents()
    return [DocumentMetadata(**d) for d in docs]

@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: str):
    """Deletes document metadata and corresponding vector embeddings."""
    doc = storage.get_document_by_id(doc_id)
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Document with ID '{doc_id}' not found."
        )
    deleted = ingest.delete_document_and_chunks(doc_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete document."
        )
    return {"status": "success", "message": f"Document '{doc['name']}' deleted successfully."}

# -------------------------------------------------------------
# Chunk Endpoint (For Citation Preview)
# -------------------------------------------------------------

@app.get("/api/chunks/{chunk_id}", response_model=ChunkDetailResponse)
def get_chunk(chunk_id: str):
    """Retrieves full text and metadata for a chunk to power the citation modal."""
    detail = ingest.get_chunk_detail(chunk_id)
    if not detail:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Chunk '{chunk_id}' not found."
        )
    return ChunkDetailResponse(**detail)

# -------------------------------------------------------------
# Chat Management Endpoints
# -------------------------------------------------------------

@app.post("/api/chats", response_model=ChatResponse)
def create_chat(payload: Optional[ChatCreate] = None):
    """Creates a new conversation."""
    chat_id = str(uuid.uuid4())
    title = (payload.title if payload and payload.title else "New Chat").strip() or "New Chat"
    chat = storage.create_chat(chat_id, title)
    return ChatResponse(**chat)

@app.get("/api/chats", response_model=List[ChatResponse])
def list_chats():
    """Returns list of chats, ordered newest first."""
    chats = storage.list_chats()
    return [ChatResponse(**c) for c in chats]

@app.patch("/api/chats/{chat_id}", response_model=ChatResponse)
def rename_chat(chat_id: str, payload: ChatUpdate):
    """Renames an existing chat."""
    chat = storage.get_chat(chat_id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found.")
    
    new_title = payload.title.strip()
    if not new_title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Title cannot be empty.")
    
    storage.update_chat_title(chat_id, new_title)
    updated = storage.get_chat(chat_id)
    return ChatResponse(**updated)

@app.delete("/api/chats/{chat_id}")
def delete_chat(chat_id: str):
    """Deletes a chat and all its associated messages."""
    chat = storage.get_chat(chat_id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found.")
    storage.delete_chat(chat_id)
    return {"status": "success", "message": "Chat deleted successfully."}

@app.get("/api/chats/{chat_id}/messages", response_model=List[MessageResponse])
def get_chat_messages(chat_id: str):
    """Returns the message history for a given chat."""
    chat = storage.get_chat(chat_id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found.")
    messages = storage.get_chat_messages(chat_id)
    return [MessageResponse(**m) for m in messages]

# -------------------------------------------------------------
# Message Sending & SSE Streaming
# -------------------------------------------------------------

@app.post("/api/chats/{chat_id}/messages")
async def send_message(chat_id: str, payload: MessageCreate):
    """
    Submits a user query, retrieves relevant chunks,
    and streams the assistant's answer token-by-token via Server-Sent Events.
    """
    chat = storage.get_chat(chat_id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found.")

    query = payload.content.strip()
    if not query:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message content cannot be empty.")

    # Check existing messages for auto-titling
    existing_messages = storage.get_chat_messages(chat_id)
    if len(existing_messages) == 0 or chat["title"] == "New Chat":
        words = query.split()
        first_words = " ".join(words[:6])
        new_title = first_words if len(words) <= 6 else f"{first_words}..."
        storage.update_chat_title(chat_id, new_title)

    # Persist user message
    user_msg_id = str(uuid.uuid4())
    storage.add_message(
        msg_id=user_msg_id,
        chat_id=chat_id,
        role="user",
        content=query,
        citations=None,
        is_offline_mode=False
    )

    # Retrieve context chunks
    chunks = retrieval.retrieve_chunks(
        query=query,
        top_k=payload.top_k,
        document_ids=payload.document_ids
    )

    doc_count = storage.get_document_count()
    conversation_history = storage.get_recent_messages(chat_id, limit=8)

    assistant_msg_id = str(uuid.uuid4())

    async def event_generator():
        accumulated_text = ""
        citations_list = []
        is_offline = False

        try:
            # Emit user message confirmed event so frontend knows msg ID
            yield f"data: {json.dumps({'type': 'user_ack', 'message_id': user_msg_id})}\n\n"

            async for event in llm.stream_answer(
                query=query,
                chunks=chunks,
                conversation_history=conversation_history,
                document_count=doc_count
            ):
                event_type = event.get("type")
                if event_type == "token":
                    accumulated_text += event.get("content", "")
                    yield f"data: {json.dumps(event)}\n\n"
                elif event_type == "citations":
                    citations_list = event.get("citations", [])
                    yield f"data: {json.dumps(event)}\n\n"
                elif event_type == "done":
                    is_offline = event.get("is_offline", False)
                    # Persist assistant message in storage
                    storage.add_message(
                        msg_id=assistant_msg_id,
                        chat_id=chat_id,
                        role="assistant",
                        content=accumulated_text,
                        citations=citations_list,
                        is_offline_mode=is_offline
                    )
                    done_payload = {
                        "type": "done",
                        "message_id": assistant_msg_id,
                        "content": accumulated_text,
                        "citations": citations_list,
                        "is_offline": is_offline
                    }
                    yield f"data: {json.dumps(done_payload)}\n\n"
                    break

        except asyncio.CancelledError:
            # Client stopped stream
            if accumulated_text.strip():
                storage.add_message(
                    msg_id=assistant_msg_id,
                    chat_id=chat_id,
                    role="assistant",
                    content=accumulated_text + " *(generation stopped)*",
                    citations=citations_list,
                    is_offline_mode=is_offline
                )
            raise
        except Exception as e:
            err_data = {"type": "error", "message": f"Stream error: {str(e)}"}
            yield f"data: {json.dumps(err_data)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

# -------------------------------------------------------------
# Feedback Endpoint
# -------------------------------------------------------------

@app.post("/api/messages/{message_id}/feedback")
def update_feedback(message_id: str, payload: FeedbackRequest):
    """Sets or clears thumbs up/down feedback on a message."""
    msg = storage.get_message(message_id)
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")
    
    if payload.feedback not in ["up", "down", None]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Feedback must be 'up', 'down', or null.")
        
    storage.update_message_feedback(message_id, payload.feedback)
    return {"status": "success", "message_id": message_id, "feedback": payload.feedback}

# -------------------------------------------------------------
# Health Check Endpoint
# -------------------------------------------------------------

@app.get("/api/health", response_model=HealthResponse)
def health_check():
    """Reports system health, database status, vector count, and key configuration."""
    db_status = "ok"
    doc_count = 0
    try:
        doc_count = storage.get_document_count()
    except Exception:
        db_status = "error"

    vector_status = "ok"
    chunk_count = 0
    try:
        col = ingest.get_collection()
        chunk_count = col.count()
    except Exception:
        vector_status = "error"

    api_configured = bool(settings.anthropic_api_key and settings.anthropic_api_key.strip())

    return HealthResponse(
        status="healthy" if db_status == "ok" and vector_status == "ok" else "degraded",
        database=db_status,
        vector_store=vector_status,
        document_count=doc_count,
        chunk_count=chunk_count,
        api_key_configured=api_configured,
        model=settings.anthropic_model,
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        default_top_k=settings.top_k
    )

# -------------------------------------------------------------
# Static Files & Frontend Routing
# -------------------------------------------------------------

STATIC_DIR = PROJECT_ROOT / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/")
def index():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"message": "Ashh API is running. static/index.html not found."}
