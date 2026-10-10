import pytest
from fastapi.testclient import TestClient
from scripts.generate_sample_pdf import create_pdf_bytes
from app.main import app
from app import storage
from app import ingest
from app.config import settings

@pytest.fixture(autouse=True)
def setup_test_api_env(tmp_path, monkeypatch):
    test_db = tmp_path / "test_api_ashh.db"
    test_chroma = tmp_path / "test_api_chroma"
    monkeypatch.setattr(settings, "db_path", test_db)
    monkeypatch.setattr(settings, "chroma_dir", test_chroma)
    monkeypatch.setattr(settings, "anthropic_api_key", "")  # Guarantee offline mode in test
    monkeypatch.setattr(ingest, "_client", None)
    monkeypatch.setattr(ingest, "_collection", None)
    storage.init_db()
    yield

def test_health_endpoint():
    with TestClient(app) as client:
        res = client.get("/api/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] in ["healthy", "degraded"]
        assert data["database"] == "ok"
        assert data["vector_store"] == "ok"
        assert data["api_key_configured"] is False

def test_rejection_of_invalid_files():
    with TestClient(app) as client:
        # Non-PDF rejection
        txt_file = ("notes.txt", b"Plain text file not allowed", "text/plain")
        res = client.post("/api/documents", files={"files": txt_file})
        assert res.status_code == 400
        assert "PDF" in res.json()["detail"]

        # Oversized file rejection (> 25MB)
        large_bytes = b"%PDF-1.4 " + b"0" * (25 * 1024 * 1024 + 10)
        oversized = ("huge.pdf", large_bytes, "application/pdf")
        res_large = client.post("/api/documents", files={"files": oversized})
        assert res_large.status_code == 400
        assert "25 MB" in res_large.json()["detail"]

def test_document_lifecycle():
    with TestClient(app) as client:
        pdf_bytes = create_pdf_bytes([
            "Ashh is a local document-grounded AI chatbot designed with clean typography."
        ])
        files = {"files": ("doc1.pdf", pdf_bytes, "application/pdf")}
        res = client.post("/api/documents", files=files)
        assert res.status_code == 200
        data = res.json()
        assert len(data["documents"]) == 1
        doc_id = data["documents"][0]["id"]
        assert data["documents"][0]["name"] == "doc1.pdf"

        # List documents
        res_list = client.get("/api/documents")
        assert res_list.status_code == 200
        docs = res_list.json()
        assert len(docs) == 1
        assert docs[0]["id"] == doc_id

        # Delete document
        res_del = client.delete(f"/api/documents/{doc_id}")
        assert res_del.status_code == 200

        # Verify deletion
        res_list2 = client.get("/api/documents")
        assert len(res_list2.json()) == 0

def test_chat_lifecycle_and_offline_message_streaming():
    with TestClient(app) as client:
        # 1. Create chat
        res_chat = client.post("/api/chats", json={"title": "Test Chat"})
        assert res_chat.status_code == 200
        chat_id = res_chat.json()["id"]

        # 2. Upload sample PDF
        pdf_bytes = create_pdf_bytes([
            "Ashh uses ChromaDB for persistent vector storage and Claude for synthesis.",
            "In offline mode, Ashh returns extractive citations directly from chunks."
        ])
        client.post("/api/documents", files={"files": ("guide.pdf", pdf_bytes, "application/pdf")})

        # 3. Send message in offline mode
        res_msg = client.post(
            f"/api/chats/{chat_id}/messages",
            json={"content": "How does Ashh work in offline mode?"}
        )
        assert res_msg.status_code == 200
        assert "text/event-stream" in res_msg.headers["content-type"]

        # Parse SSE stream
        raw_events = res_msg.text.split("\n\n")
        events = []
        import json
        for line in raw_events:
            line = line.strip()
            if line.startswith("data: "):
                data_str = line[6:]
                try:
                    events.append(json.loads(data_str))
                except Exception:
                    pass

        event_types = [e.get("type") for e in events]
        assert "token" in event_types
        assert "citations" in event_types
        assert "done" in event_types

        # Verify done payload
        done_event = next(e for e in events if e.get("type") == "done")
        assert done_event["is_offline"] is True
        assistant_msg_id = done_event["message_id"]

        # 4. Check message history
        res_history = client.get(f"/api/chats/{chat_id}/messages")
        assert res_history.status_code == 200
        history = res_history.json()
        assert len(history) == 2  # user and assistant
        assert history[0]["role"] == "user"
        assert history[1]["role"] == "assistant"
        assert history[1]["is_offline_mode"] is True

        # 5. Test message feedback
        res_fb = client.post(
            f"/api/messages/{assistant_msg_id}/feedback",
            json={"feedback": "up"}
        )
        assert res_fb.status_code == 200
        assert res_fb.json()["feedback"] == "up"

        # 6. Test rename chat
        res_rename = client.patch(
            f"/api/chats/{chat_id}",
            json={"title": "Renamed Chat"}
        )
        assert res_rename.status_code == 200
        assert res_rename.json()["title"] == "Renamed Chat"

        # 7. Test delete chat
        res_del_chat = client.delete(f"/api/chats/{chat_id}")
        assert res_del_chat.status_code == 200

        # Verify chat is gone
        res_list_chats = client.get("/api/chats")
        assert len(res_list_chats.json()) == 0
