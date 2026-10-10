#!/usr/bin/env python3
"""
Sample PDF generator for Ashh.
Creates multi-page PDFs with rich realistic text for testing RAG and ingestion without external dependencies.
"""

from pathlib import Path
from typing import List

def create_pdf_bytes(pages: List[str]) -> bytes:
    """
    Constructs a valid PDF 1.4 binary containing the provided text on each page.
    """
    objs = []
    page_obj_ids = []
    cur_id = 3

    # Base Font (Helvetica)
    font_id = cur_id
    cur_id += 1
    font_obj = f"{font_id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj"
    objs.append(font_obj)

    for text in pages:
        # Escape parentheses and backslashes in PDF literal strings
        clean_text = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        
        # Split text into lines for readable vertical layout
        lines = clean_text.split("\n")
        stream_cmds = ["BT", "/F1 11 Tf", "50 740 Td", "14 TL"]
        for idx, line in enumerate(lines):
            if idx > 0:
                stream_cmds.append("T*")
            stream_cmds.append(f"({line}) Tj")
        stream_cmds.append("ET")
        
        stream_content = "\n".join(stream_cmds)
        stream_len = len(stream_content.encode("latin1"))
        
        content_id = cur_id
        cur_id += 1
        objs.append(
            f"{content_id} 0 obj\n<< /Length {stream_len} >>\nstream\n{stream_content}\nendstream\nendobj"
        )

        p_id = cur_id
        cur_id += 1
        page_obj_ids.append(p_id)
        objs.append(
            f"{p_id} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Contents {content_id} 0 R /Resources << /Font << /F1 {font_id} 0 R >> >> >>\nendobj"
        )

    kids = " ".join(f"{pid} 0 R" for pid in page_obj_ids)
    pages_obj = f"2 0 obj\n<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>\nendobj"
    catalog_obj = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj"

    all_objs = [catalog_obj, pages_obj] + objs

    body = "%PDF-1.4\n"
    xref = ["xref\n0 " + str(len(all_objs) + 1) + "\n0000000000 65535 f \n"]
    for obj in all_objs:
        offset = len(body.encode("latin1"))
        xref.append(f"{offset:010d} 00000 n \n")
        body += obj + "\n"

    startxref = len(body.encode("latin1"))
    body += "".join(xref)
    body += f"trailer\n<< /Size {len(all_objs) + 1} /Root 1 0 R >>\nstartxref\n{startxref}\n%%EOF"
    return body.encode("latin1")

def generate_sample_documents(output_dir: Path):
    """Generates two comprehensive sample PDFs for demonstration and testing."""
    output_dir.mkdir(parents=True, exist_ok=True)

    # Document 1: Quantum AI & Transformer Architectures
    doc1_pages = [
        (
            "Ashh Research Paper: Attention and Retrieval Augmented Generation\n"
            "Author: Ashh AI Research Lab\n\n"
            "Abstract: This paper presents modern methods in grounded question answering.\n"
            "Retrieval Augmented Generation (RAG) significantly reduces model hallucinations by anchoring\n"
            "responses in verified document chunks.\n"
            "The system chunks incoming text into approximately 800 characters with 120 character overlaps.\n"
            "Dense vector embeddings index every chunk in a vector store like ChromaDB."
        ),
        (
            "Section 2: Vector Space Search & Cosine Similarity\n"
            "In ChromaDB, chunk embeddings are mapped onto a high-dimensional manifold.\n"
            "When a query arrives, top-k chunks are selected based on nearest neighbor metrics.\n"
            "Top-k defaults to 5 chunks, but can be configured between 1 and 10 chunks depending on context budget.\n"
            "Document scoping enables users to constrain search strictly to specific files."
        ),
        (
            "Section 3: Verifiable Numbered Source Citations\n"
            "Grounded models cite sources using bracketed tokens such as [1] and [2].\n"
            "Every statement can be verified against the source text and exact page number.\n"
            "When no documents are loaded, the system gracefully advises the user to upload reference material.\n"
            "Offline extractive mode ensures uninterrupted operation even without cloud LLM keys."
        )
    ]

    doc1_bytes = create_pdf_bytes(doc1_pages)
    doc1_path = output_dir / "sample_research_paper.pdf"
    doc1_path.write_bytes(doc1_bytes)
    print(f"Generated sample PDF at: {doc1_path}")

    # Document 2: Ashh Company Employee Handbook
    doc2_pages = [
        (
            "Ashh Corp Employee Handbook 2026\n"
            "Welcome to Ashh! This handbook outlines company policies, benefits, and remote work guidelines.\n\n"
            "Policy 1: Work Hours and Flexibility\n"
            "Core collaboration hours are 10:00 AM to 3:00 PM Eastern Time.\n"
            "Team members are free to structure their remaining hours according to their productivity rhythm."
        ),
        (
            "Policy 2: Health, Wellness and Annual Leave\n"
            "Full-time employees receive 25 days of paid time off (PTO) annually.\n"
            "Sick days are uncapped, and the company provides a $1,200 annual learning and wellness stipend.\n"
            "Health insurance takes effect on your first day of employment."
        ),
        (
            "Policy 3: Security, Device Policies and Data Privacy\n"
            "All work laptops must use full-disk encryption and multi-factor authentication (MFA).\n"
            "Proprietary company documents must not be uploaded to unverified third-party public AI tools.\n"
            "Local document RAG applications like Ashh keep document storage completely on-premises."
        )
    ]

    doc2_bytes = create_pdf_bytes(doc2_pages)
    doc2_path = output_dir / "sample_employee_handbook.pdf"
    doc2_path.write_bytes(doc2_bytes)
    print(f"Generated sample PDF at: {doc2_path}")

if __name__ == "__main__":
    import sys
    out = Path(__file__).resolve().parent.parent / "data"
    generate_sample_documents(out)
