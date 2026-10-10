import pytest
from pathlib import Path
from scripts.generate_sample_pdf import create_pdf_bytes
from app import storage
from app import ingest
from app import retrieval
from app.config import settings

@pytest.fixture(autouse=True)
def setup_test_env(tmp_path, monkeypatch):
    test_db = tmp_path / "test_ashh.db"
    test_chroma = tmp_path / "test_chroma"
    monkeypatch.setattr(settings, "db_path", test_db)
    monkeypatch.setattr(settings, "chroma_dir", test_chroma)
    monkeypatch.setattr(ingest, "_client", None)
    monkeypatch.setattr(ingest, "_collection", None)
    storage.init_db()
    yield

def test_pdf_ingest_and_chunk_metadata():
    pages = [
        "First page discussing retrieval augmented generation and chunking strategies in Ashh.",
        "Second page detailing vector distance metrics and metadata attributes attached to chunks."
    ]
    pdf_bytes = create_pdf_bytes(pages)
    
    doc_meta, skipped, is_dup = ingest.ingest_pdf(pdf_bytes, "test_document.pdf")
    assert not is_dup
    assert doc_meta.name == "test_document.pdf"
    assert doc_meta.page_count == 2
    assert doc_meta.chunk_count >= 2
    assert len(skipped) == 0

    # Verify chunk details
    col = ingest.get_collection()
    res = col.get(where={"document_id": doc_meta.id})
    assert len(res["ids"]) == doc_meta.chunk_count
    
    # Check metadata fields
    first_meta = res["metadatas"][0]
    assert first_meta["document_id"] == doc_meta.id
    assert first_meta["file_name"] == "test_document.pdf"
    assert "page" in first_meta
    assert "chunk_index" in first_meta
    assert first_meta["page"] in [1, 2]

def test_deduplication_on_hash():
    pages = ["Unique content for deduplication test verifying SHA-256 hash detection."]
    pdf_bytes = create_pdf_bytes(pages)

    # First ingest
    doc1, skipped1, is_dup1 = ingest.ingest_pdf(pdf_bytes, "doc.pdf")
    assert not is_dup1

    # Second ingest of exact same bytes
    doc2, skipped2, is_dup2 = ingest.ingest_pdf(pdf_bytes, "doc_renamed.pdf")
    assert is_dup2
    assert doc2.id == doc1.id
    assert doc2.file_hash == doc1.file_hash

    # Ensure duplicate did not multiply chunks in SQLite or Chroma
    docs = storage.list_documents()
    assert len(docs) == 1

def test_scanned_or_empty_page_handling():
    # Page 1 has text, Page 2 is empty/whitespace, Page 3 has text
    pages = [
        "Page one with actionable text.",
        "",  # Empty page
        "Page three with further findings."
    ]
    pdf_bytes = create_pdf_bytes(pages)

    doc_meta, skipped, is_dup = ingest.ingest_pdf(pdf_bytes, "sparse.pdf")
    assert 2 in skipped
    assert doc_meta.page_count == 3

def test_retrieval_filtering():
    pdf_a = create_pdf_bytes(["Quantum mechanics and topological qubits in quantum computers."])
    pdf_b = create_pdf_bytes(["Human resources guidelines and annual employee health benefits."])

    doc_a, _, _ = ingest.ingest_pdf(pdf_a, "quantum.pdf")
    doc_b, _, _ = ingest.ingest_pdf(pdf_b, "hr.pdf")

    # Retrieve with filter to only doc_a
    results_a = retrieval.retrieve_chunks("What is the policy or concept?", top_k=5, document_ids=[doc_a.id])
    assert len(results_a) > 0
    for r in results_a:
        assert r["document_id"] == doc_a.id
        assert r["document_name"] == "quantum.pdf"

    # Retrieve with filter to only doc_b
    results_b = retrieval.retrieve_chunks("What is the policy or concept?", top_k=5, document_ids=[doc_b.id])
    assert len(results_b) > 0
    for r in results_b:
        assert r["document_id"] == doc_b.id
        assert r["document_name"] == "hr.pdf"

def test_document_deletion():
    pdf_bytes = create_pdf_bytes(["Temporary document content scheduled for immediate removal."])
    doc_meta, _, _ = ingest.ingest_pdf(pdf_bytes, "to_delete.pdf")

    assert storage.get_document_by_id(doc_meta.id) is not None
    ingest.delete_document_and_chunks(doc_meta.id)

    assert storage.get_document_by_id(doc_meta.id) is None
    col = ingest.get_collection()
    res = col.get(where={"document_id": doc_meta.id})
    assert len(res["ids"]) == 0
