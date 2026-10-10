import asyncio
import re
from typing import AsyncGenerator, List, Dict, Any, Optional
import anthropic
from app.config import settings
from app.retrieval import build_context_prompt

SYSTEM_PROMPT_TEMPLATE = """You are Ashh, an elegant and precise document-grounded AI assistant.
Answer the user's question accurately and exclusively using the provided context blocks.

Strict Instructions:
1. Rely ONLY on the provided context. Do NOT use outside knowledge.
2. Cite sources using bracketed numbers like [1], [2], [3] directly matching the numbered context blocks provided below.
3. Every claim or factual statement should be grounded with a citation marker like [1].
4. If the context does not contain enough information to answer the question, state clearly and politely that the answer cannot be found in the uploaded documents. Do not speculate.
5. NEVER invent citations or mention references that do not exist in the context.
6. Provide answers in clear, well-structured Markdown (using paragraphs, bullet points, or bold text where appropriate).

Context Blocks:
{context}
"""

async def generate_offline_extractive_answer(
    query: str,
    chunks: List[Dict[str, Any]],
    reason: Optional[str] = None
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Streams an extractive answer when Anthropic API is not configured or unavailable.
    """
    if reason:
        header = f"> *Ashh is running in offline mode ({reason}).*\n\n"
    else:
        header = "> *Ashh is running in offline mode (no API key configured).*\n\n"

    if not chunks:
        content = (
            header +
            "No uploaded documents were found matching your query. "
            "Please upload a PDF document using the sidebar or upload button, "
            "and I will be delighted to answer your questions based on it."
        )
    else:
        parts = [header]
        parts.append(
            f"Here are the most relevant excerpts found for **\"{query}\"**:\n\n"
        )
        for chunk in chunks:
            cid = chunk["citation_id"]
            doc_name = chunk["document_name"]
            page = chunk["page"]
            text = chunk["text"].strip()
            # Clean text for quote block
            clean_text = "\n> ".join(text.splitlines())
            parts.append(f"**Source [{cid}]** — *{doc_name}* (Page {page}):\n> {clean_text}\n\n")

        parts.append(
            "*Note: Add an `ANTHROPIC_API_KEY` to `.env` to enable full Claude conversational synthesis.*"
        )
        content = "".join(parts)

    # Stream the content in token-like chunks for smooth UI feel
    words = content.split(" ")
    full_text = ""
    for i in range(0, len(words), 3):
        chunk_str = " ".join(words[i:i+3])
        if i + 3 < len(words):
            chunk_str += " "
        full_text += chunk_str
        yield {"type": "token", "content": chunk_str}
        await asyncio.sleep(0.015)

    # Yield citations
    yield {"type": "citations", "citations": chunks}
    yield {"type": "done", "full_content": full_text, "is_offline": True}

async def stream_answer(
    query: str,
    chunks: List[Dict[str, Any]],
    conversation_history: List[Dict[str, Any]],
    document_count: int = 0
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Streams answers either via Claude LLM or offline extractive mode.
    Handles exceptions by falling back gracefully to offline mode.
    """
    # If no documents uploaded at all
    if document_count == 0:
        msg = (
            "No documents have been uploaded yet. "
            "Please upload one or more PDFs using the upload zone or button in the sidebar, "
            "and I will answer your questions using their contents."
        )
        words = msg.split(" ")
        for i, word in enumerate(words):
            token = word + (" " if i < len(words) - 1 else "")
            yield {"type": "token", "content": token}
            await asyncio.sleep(0.015)
        yield {"type": "citations", "citations": []}
        yield {"type": "done", "full_content": msg, "is_offline": not bool(settings.anthropic_api_key)}
        return

    # If no API key configured, use offline extractive generator
    if not settings.anthropic_api_key or not settings.anthropic_api_key.strip():
        async for item in generate_offline_extractive_answer(query, chunks, reason="offline mode active"):
            yield item
        return

    # Prepare context and messages for Claude
    context_text = build_context_prompt(chunks)
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(context=context_text)

    # Build history turns: ensuring alternating roles
    messages: List[Dict[str, Any]] = []
    
    # Take up to last 8 messages for context
    recent_history = conversation_history[-8:] if conversation_history else []
    for m in recent_history:
        role = "user" if m.get("role") == "user" else "assistant"
        content = m.get("content", "")
        if not content:
            continue
        # Avoid duplicate consecutive roles
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"] += f"\n\n{content}"
        else:
            messages.append({"role": role, "content": content})

    # Ensure the latest turn is the current query as a user message
    if messages and messages[-1]["role"] == "user":
        messages[-1]["content"] = query
    else:
        messages.append({"role": "user", "content": query})

    # Ensure history starts with user role (Anthropic requirement)
    while messages and messages[0]["role"] != "user":
        messages.pop(0)

    if not messages:
        messages = [{"role": "user", "content": query}]

    # Call Anthropic API with streaming
    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        full_content = ""
        
        async with client.messages.stream(
            model=settings.anthropic_model,
            max_tokens=2048,
            system=system_prompt,
            messages=messages
        ) as stream:
            async for text in stream.text_stream:
                full_content += text
                yield {"type": "token", "content": text}

        # Send final citations and done event
        yield {"type": "citations", "citations": chunks}
        yield {"type": "done", "full_content": full_content, "is_offline": False}

    except Exception as e:
        error_msg = str(e)
        # Fall back to extractive mode without crashing
        async for item in generate_offline_extractive_answer(
            query,
            chunks,
            reason=f"LLM request error: {error_msg[:60]}..."
        ):
            yield item
