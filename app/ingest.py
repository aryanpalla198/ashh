import io
import uuid
import hashlib
from datetime import datetime, timezone
from typing import Tuple, List, Dict, Any, Optional
import pypdf
from langchain_text_splitters import RecursiveCharacterTextSplitter
import chromadb
from chromadb.api import ClientAPI
from chromadb.api.models.Collection import Collection

from app.config import settings
from app import storage
from app.schemas import DocumentMetadata

_client: Optional[ClientAPI] = None
_collection: Optional[Collection] = None

def get_chroma_client() -> ClientAPI:
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(path=str(settings.chroma_dir))
    return _client

def get_collection() -> Collection:
    global _collection
    if _collection is None:
        client = get_chroma_client()
        _collection = client.get_or_create_collection(name="ashh_documents")
    return _collection

def compute_file_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def ingest_pdf(file_bytes: bytes, filename: str) -> Tuple[DocumentMetadata, List[int], bool]:
    """
    Ingests a PDF file:
    - Checks for deduplication via content hash.
    - Extracts text page by page.
    - Splits text into chunks.
    - Saves chunks with metadata into ChromaDB.
    - Saves document metadata into SQLite.
    Returns (document_metadata, skipped_pages, is_duplicate).
    """
    file_hash = compute_file_hash(file_bytes)
    
    # Check deduplication
    existing_doc = storage.get_document_by_hash(file_hash)
    if existing_doc:
        doc_meta = DocumentMetadata(
            id=existing_doc["id"],
            name=existing_doc["name"],
            page_count=existing_doc["page_count"],
            chunk_count=existing_doc["chunk_count"],
            upload_time=existing_doc["upload_time"],
            file_hash=existing_doc["file_hash"],
            file_size_bytes=existing_doc.get("file_size_bytes", 0)
        )
        return doc_meta, [], True

    doc_id = str(uuid.uuid4())
    upload_time = datetime.now(timezone.utc).isoformat()
    file_size_bytes = len(file_bytes)
    
    # Read PDF
    try:
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        total_pages = len(reader.pages)
    except Exception as e:
        raise ValueError(f"Failed to parse PDF: {str(e)}")
    
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        separators=["\n\n", "\n", ". ", "? ", "! ", " ", ""]
    )
    
    skipped_empty_pages: List[int] = []
    chunk_ids: List[str] = []
    chunk_texts: List[str] = []
    chunk_metadatas: List[Dict[str, Any]] = []
    
    chunk_counter = 0
    for page_idx, page in enumerate(reader.pages, start=1):
        try:
            page_text = page.extract_text() or ""
        except Exception:
            page_text = ""
            
        cleaned_text = page_text.strip()
        if not cleaned_text:
            skipped_empty_pages.append(page_idx)
            continue
            
        page_chunks = splitter.split_text(cleaned_text)
        for chunk in page_chunks:
            chunk_counter += 1
            # Unique deterministic chunk id
            chunk_id = f"{doc_id}_c{chunk_counter}"
            chunk_ids.append(chunk_id)
            chunk_texts.append(chunk)
            chunk_metadatas.append({
                "document_id": doc_id,
                "file_name": filename,
                "page": page_idx,
                "chunk_index": chunk_counter
            })
            
    # Add to Chroma collection if there are chunks
    if chunk_ids:
        collection = get_collection()
        # Add in batches if necessary
        batch_size = 500
        for i in range(0, len(chunk_ids), batch_size):
            collection.add(
                ids=chunk_ids[i:i + batch_size],
                documents=chunk_texts[i:i + batch_size],
                metadatas=chunk_metadatas[i:i + batch_size]
            )
            
    doc_meta = DocumentMetadata(
        id=doc_id,
        name=filename,
        page_count=total_pages,
        chunk_count=chunk_counter,
        upload_time=upload_time,
        file_hash=file_hash,
        file_size_bytes=file_size_bytes
    )
    
    storage.insert_document(doc_meta.model_dump())
    return doc_meta, skipped_empty_pages, False

def delete_document_and_chunks(doc_id: str) -> bool:
    collection = get_collection()
    try:
        collection.delete(where={"document_id": doc_id})
    except Exception:
        pass
    return storage.delete_document(doc_id)

def ingest_raw_text(text: str, name: str) -> Tuple[DocumentMetadata, bool]:
    """
    Ingests raw typed or pasted text directly as a document.
    """
    clean_text = text.strip()
    if not clean_text:
        raise ValueError("Text content cannot be empty.")
    
    file_bytes = clean_text.encode("utf-8")
    file_hash = compute_file_hash(file_bytes)
    
    existing_doc = storage.get_document_by_hash(file_hash)
    if existing_doc:
        doc_meta = DocumentMetadata(
            id=existing_doc["id"],
            name=existing_doc["name"],
            page_count=existing_doc["page_count"],
            chunk_count=existing_doc["chunk_count"],
            upload_time=existing_doc["upload_time"],
            file_hash=existing_doc["file_hash"],
            file_size_bytes=existing_doc.get("file_size_bytes", 0)
        )
        return doc_meta, True

    doc_id = str(uuid.uuid4())
    upload_time = datetime.now(timezone.utc).isoformat()
    file_size_bytes = len(file_bytes)
    
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        separators=["\n\n", "\n", ". ", "? ", "! ", " ", ""]
    )
    
    chunks = splitter.split_text(clean_text)
    chunk_ids: List[str] = []
    chunk_texts: List[str] = []
    chunk_metadatas: List[Dict[str, Any]] = []
    
    for idx, chunk in enumerate(chunks, start=1):
        chunk_id = f"{doc_id}_c{idx}"
        chunk_ids.append(chunk_id)
        chunk_texts.append(chunk)
        chunk_metadatas.append({
            "document_id": doc_id,
            "file_name": name,
            "page": 1,
            "chunk_index": idx
        })
        
    if chunk_ids:
        collection = get_collection()
        collection.add(
            ids=chunk_ids,
            documents=chunk_texts,
            metadatas=chunk_metadatas
        )
        
    doc_meta = DocumentMetadata(
        id=doc_id,
        name=name,
        page_count=1,
        chunk_count=len(chunk_ids),
        upload_time=upload_time,
        file_hash=file_hash,
        file_size_bytes=file_size_bytes
    )
    
    storage.insert_document(doc_meta.model_dump())
    return doc_meta, False

def get_chunk_detail(chunk_id: str) -> Optional[Dict[str, Any]]:
    collection = get_collection()
    res = collection.get(ids=[chunk_id], include=["documents", "metadatas"])
    if not res["ids"] or len(res["ids"]) == 0:
        return None
    
    meta = res["metadatas"][0] if res.get("metadatas") else {}
    text = res["documents"][0] if res.get("documents") else ""
    return {
        "chunk_id": chunk_id,
        "document_id": meta.get("document_id", ""),
        "document_name": meta.get("file_name", "Unknown Document"),
        "page": meta.get("page", 1),
        "chunk_index": meta.get("chunk_index", 1),
        "text": text
    }
