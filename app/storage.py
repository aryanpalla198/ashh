import sqlite3
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any
from app.config import settings

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(settings.db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    conn = get_connection()
    try:
        with conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS documents (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    page_count INTEGER NOT NULL,
                    chunk_count INTEGER NOT NULL,
                    upload_time TEXT NOT NULL,
                    file_hash TEXT NOT NULL UNIQUE,
                    file_size_bytes INTEGER DEFAULT 0
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS chats (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    chat_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    citations TEXT,
                    feedback TEXT,
                    is_offline_mode INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE
                )
            """)
    finally:
        conn.close()

# Document Operations
def get_document_by_hash(file_hash: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.execute("SELECT * FROM documents WHERE file_hash = ?", (file_hash,))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def get_document_by_id(doc_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def insert_document(doc: Dict[str, Any]):
    conn = get_connection()
    try:
        with conn:
            conn.execute("""
                INSERT INTO documents (id, name, page_count, chunk_count, upload_time, file_hash, file_size_bytes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                doc["id"],
                doc["name"],
                doc["page_count"],
                doc["chunk_count"],
                doc["upload_time"],
                doc["file_hash"],
                doc.get("file_size_bytes", 0)
            ))
    finally:
        conn.close()

def list_documents() -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.execute("SELECT * FROM documents ORDER BY upload_time DESC")
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

def delete_document(doc_id: str) -> bool:
    conn = get_connection()
    try:
        with conn:
            cur = conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
            return cur.rowcount > 0
    finally:
        conn.close()

def get_document_count() -> int:
    conn = get_connection()
    try:
        cur = conn.execute("SELECT COUNT(*) FROM documents")
        return cur.fetchone()[0]
    finally:
        conn.close()

# Chat Operations
def create_chat(chat_id: str, title: str) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        with conn:
            conn.execute("""
                INSERT INTO chats (id, title, created_at, updated_at)
                VALUES (?, ?, ?, ?)
            """, (chat_id, title, now, now))
        return {"id": chat_id, "title": title, "created_at": now, "updated_at": now}
    finally:
        conn.close()

def list_chats() -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.execute("SELECT * FROM chats ORDER BY updated_at DESC")
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()

def get_chat(chat_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.execute("SELECT * FROM chats WHERE id = ?", (chat_id,))
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def update_chat_title(chat_id: str, title: str) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        with conn:
            cur = conn.execute("UPDATE chats SET title = ?, updated_at = ? WHERE id = ?", (title, now, chat_id))
            return cur.rowcount > 0
    finally:
        conn.close()

def touch_chat(chat_id: str):
    now = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        with conn:
            conn.execute("UPDATE chats SET updated_at = ? WHERE id = ?", (now, chat_id))
    finally:
        conn.close()

def delete_chat(chat_id: str) -> bool:
    conn = get_connection()
    try:
        with conn:
            cur = conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
            return cur.rowcount > 0
    finally:
        conn.close()

# Message Operations
def add_message(
    msg_id: str,
    chat_id: str,
    role: str,
    content: str,
    citations: Optional[List[Dict[str, Any]]] = None,
    feedback: Optional[str] = None,
    is_offline_mode: bool = False
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    citations_json = json.dumps(citations) if citations is not None else None
    conn = get_connection()
    try:
        with conn:
            conn.execute("""
                INSERT INTO messages (id, chat_id, role, content, citations, feedback, is_offline_mode, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                msg_id,
                chat_id,
                role,
                content,
                citations_json,
                feedback,
                1 if is_offline_mode else 0,
                now
            ))
            # Also touch the chat updated_at
            conn.execute("UPDATE chats SET updated_at = ? WHERE id = ?", (now, chat_id))
        return {
            "id": msg_id,
            "chat_id": chat_id,
            "role": role,
            "content": content,
            "citations": citations,
            "feedback": feedback,
            "is_offline_mode": is_offline_mode,
            "created_at": now
        }
    finally:
        conn.close()

def get_chat_messages(chat_id: str) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.execute("SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC", (chat_id,))
        results = []
        for r in cur.fetchall():
            d = dict(r)
            d["is_offline_mode"] = bool(d["is_offline_mode"])
            if d.get("citations"):
                try:
                    d["citations"] = json.loads(d["citations"])
                except Exception:
                    d["citations"] = []
            else:
                d["citations"] = None
            results.append(d)
        return results
    finally:
        conn.close()

def get_recent_messages(chat_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.execute("""
            SELECT * FROM messages 
            WHERE chat_id = ? 
            ORDER BY created_at DESC 
            LIMIT ?
        """, (chat_id, limit))
        rows = cur.fetchall()
        # Reverse to chronological order
        results = []
        for r in reversed(rows):
            d = dict(r)
            d["is_offline_mode"] = bool(d["is_offline_mode"])
            if d.get("citations"):
                try:
                    d["citations"] = json.loads(d["citations"])
                except Exception:
                    d["citations"] = []
            else:
                d["citations"] = None
            results.append(d)
        return results
    finally:
        conn.close()

def update_message_feedback(msg_id: str, feedback: Optional[str]) -> bool:
    conn = get_connection()
    try:
        with conn:
            cur = conn.execute("UPDATE messages SET feedback = ? WHERE id = ?", (feedback, msg_id))
            return cur.rowcount > 0
    finally:
        conn.close()

def get_message(msg_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        cur = conn.execute("SELECT * FROM messages WHERE id = ?", (msg_id,))
        row = cur.fetchone()
        if not row:
            return None
        d = dict(row)
        d["is_offline_mode"] = bool(d["is_offline_mode"])
        if d.get("citations"):
            try:
                d["citations"] = json.loads(d["citations"])
            except Exception:
                d["citations"] = []
        else:
            d["citations"] = None
        return d
    finally:
        conn.close()
