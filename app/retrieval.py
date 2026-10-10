from typing import List, Dict, Any, Optional
from app.config import settings
from app.ingest import get_collection

def retrieve_chunks(
    query: str,
    top_k: Optional[int] = None,
    document_ids: Optional[List[str]] = None
) -> List[Dict[str, Any]]:
    """
    Retrieves top-k relevant chunks from ChromaDB for the given query.
    Optionally filters by document_ids.
    """
    k = top_k if (top_k is not None and top_k > 0) else settings.top_k
    collection = get_collection()
    
    total_count = collection.count()
    if total_count == 0:
        return []
        
    n_results = min(k, total_count)
    
    where_filter = None
    if document_ids:
        # Filter out empty or whitespace IDs
        valid_doc_ids = [d for d in document_ids if d and d.strip()]
        if len(valid_doc_ids) == 1:
            where_filter = {"document_id": valid_doc_ids[0]}
        elif len(valid_doc_ids) > 1:
            where_filter = {"document_id": {"$in": valid_doc_ids}}

    try:
        results = collection.query(
            query_texts=[query],
            n_results=n_results,
            where=where_filter,
            include=["documents", "metadatas", "distances"]
        )
    except Exception as e:
        # In case where filter matches 0 documents or ChromaDB returns an issue
        return []

    if not results or not results.get("ids") or len(results["ids"][0]) == 0:
        return []

    chunks: List[Dict[str, Any]] = []
    chunk_ids = results["ids"][0]
    texts = results["documents"][0]
    metas = results["metadatas"][0]

    for idx, (cid, text, meta) in enumerate(zip(chunk_ids, texts, metas), start=1):
        # Excerpt is first ~160 characters
        clean_text = " ".join(text.split())
        excerpt = clean_text[:160] + "..." if len(clean_text) > 160 else clean_text
        chunks.append({
            "citation_id": idx,
            "chunk_id": cid,
            "document_id": meta.get("document_id", ""),
            "document_name": meta.get("file_name", "Unknown Document"),
            "page": meta.get("page", 1),
            "chunk_index": meta.get("chunk_index", 1),
            "text": text,
            "excerpt": excerpt
        })

    return chunks

def build_context_prompt(chunks: List[Dict[str, Any]]) -> str:
    """
    Builds numbered context blocks for prompt injection.
    """
    if not chunks:
        return "No documents or relevant excerpts available."

    blocks = []
    for chunk in chunks:
        blocks.append(
            f"[{chunk['citation_id']}] Document: {chunk['document_name']} (Page {chunk['page']})\n"
            f"{chunk['text']}"
        )
    return "\n\n".join(blocks)
