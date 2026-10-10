from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

# Document Schemas
class DocumentMetadata(BaseModel):
    id: str
    name: str
    page_count: int
    chunk_count: int
    upload_time: str
    file_hash: str
    file_size_bytes: int = 0

class DocumentUploadResponse(BaseModel):
    documents: List[DocumentMetadata]
    skipped_empty_pages: Dict[str, List[int]] = {}
    message: str

class TextDocumentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    content: str = Field(..., min_length=1)

# Chat Schemas
class ChatCreate(BaseModel):
    title: Optional[str] = None

class ChatUpdate(BaseModel):
    title: str

class ChatResponse(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str

# Message Schemas
class CitationItem(BaseModel):
    citation_id: int
    chunk_id: str
    document_id: str
    document_name: str
    page: int
    excerpt: str

class MessageCreate(BaseModel):
    content: str
    document_ids: Optional[List[str]] = None
    top_k: Optional[int] = None

class MessageResponse(BaseModel):
    id: str
    chat_id: str
    role: str  # 'user' | 'assistant'
    content: str
    citations: Optional[List[CitationItem]] = None
    feedback: Optional[str] = None  # 'up' | 'down' | None
    is_offline_mode: bool = False
    created_at: str

class FeedbackRequest(BaseModel):
    feedback: Optional[str] = None  # 'up', 'down', or None

# Chunk Schema
class ChunkDetailResponse(BaseModel):
    chunk_id: str
    document_id: str
    document_name: str
    page: int
    chunk_index: int
    text: str

# Health Schema
class HealthResponse(BaseModel):
    status: str
    database: str
    vector_store: str
    document_count: int
    chunk_count: int
    api_key_configured: bool
    model: str
    chunk_size: int
    chunk_overlap: int
    default_top_k: int
