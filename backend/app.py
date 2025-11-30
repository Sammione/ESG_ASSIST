import os
import io
import json
import math
from datetime import datetime
from typing import List, Dict, Any, Optional

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

import google.generativeai as genai
import faiss
import numpy as np
from pypdf import PdfReader


# ---------------------------
# Environment & Gemini config
# ---------------------------
load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise RuntimeError("GEMINI_API_KEY not set in .env")

genai.configure(api_key=api_key)

GEN_MODEL = "models/gemini-2.5-flash"
EMBED_MODEL = "models/text-embedding-004"

gen_model = genai.GenerativeModel(GEN_MODEL)


# ---------------------------
# Utility: robust JSON parsing
# ---------------------------
def parse_strict_json(raw: str) -> Any:
    """
    Try to robustly parse JSON that may be wrapped in ```json ... ``` fences
    or have extra explanation around it.
    """
    s = raw.strip()

    # Strip markdown code fences if present
    if s.startswith("```"):
        # Remove leading ``` or ```json
        if s.lower().startswith("```json"):
            s = s[7:]  # len("```json") = 7
        else:
            s = s[3:]  # len("```") = 3

        # Remove trailing ```
        if s.endswith("```"):
            s = s[:-3]

    s = s.strip()

    # As an extra safety net: take content between first { and last }
    first = s.find("{")
    last = s.rfind("}")
    if first != -1 and last != -1 and last > first:
        s = s[first:last + 1]

    return json.loads(s)


# ---------------------------
# Simple in-memory ESG index using FAISS
# ---------------------------
def l2_normalize(vec):
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


class ESGIndex:
    def __init__(self):
        self.index: Optional[faiss.IndexFlatIP] = None
        self.emb_dim: Optional[int] = None
        self.chunks: List[Dict[str, Any]] = []
        self.reports: Dict[str, Dict[str, Any]] = {}

    def _init_index_if_needed(self, example_embedding: List[float]):
        if self.emb_dim is None:
            self.emb_dim = len(example_embedding)
            self.index = faiss.IndexFlatIP(self.emb_dim)

    def _embed_text(self, text: str) -> List[float]:
        resp = genai.embed_content(model=EMBED_MODEL, content=text)
        emb = resp["embedding"]
        return l2_normalize(emb)

    def _embed_texts(self, texts: List[str]) -> List[List[float]]:
        return [self._embed_text(t) for t in texts]

    def _chunk_pages(
        self,
        pages: List[str],
        chunk_chars: int = 1600,   # bigger chunks for speed
        overlap: int = 150,
        max_chunks: int = 800,
    ):
        chunks = []
        for page_idx, page_text in enumerate(pages, start=1):
            text = (page_text or "").strip()
            if not text:
                continue
            start = 0
            n = len(text)
            while start < n:
                if len(chunks) >= max_chunks:
                    return chunks
                end = min(start + chunk_chars, n)
                chunk = text[start:end].strip()
                if len(chunk) > 50:
                    chunks.append((chunk, page_idx))
                start = end - overlap
                if start < 0:
                    start = 0
        return chunks

    def add_report(
        self,
        name: str,
        content: str,
        pages_text: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        report_id = f"rep_{len(self.reports) + 1}_{int(datetime.utcnow().timestamp())}"
        pages = pages_text if pages_text is not None else [content]

        chunks_with_pages = self._chunk_pages(pages)
        if not chunks_with_pages:
            raise ValueError("No text chunks extracted from report")

        texts = [c[0] for c in chunks_with_pages]
        embeddings = self._embed_texts(texts)
        self._init_index_if_needed(embeddings[0])

        vecs = np.array(embeddings, dtype="float32")
        self.index.add(vecs)

        for chunk_text, page in chunks_with_pages:
            self.chunks.append(
                {
                    "id": len(self.chunks),
                    "text": chunk_text,
                    "report_id": report_id,
                    "report_name": name,
                    "page": page,
                }
            )

        report_meta = {
            "id": report_id,
            "name": name,
            "pages": len(pages),
            "uploaded_at": datetime.utcnow().isoformat(),
        }
        self.reports[report_id] = report_meta
        return report_meta

    def search(
        self,
        query: str,
        top_k: int = 8,
        report_ids: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        if self.index is None or not self.chunks:
            return []

        q_emb = self._embed_text(query)

        q_vec = np.array([q_emb], dtype="float32")
        search_k = max(top_k * 3, top_k)
        distances, indices = self.index.search(q_vec, search_k)

        results = []
        seen_ids = set()
        allowed_reports = set(report_ids) if report_ids else None

        for idx, score in zip(indices[0], distances[0]):
            if idx < 0 or idx >= len(self.chunks):
                continue
            chunk = self.chunks[idx]
            if allowed_reports and chunk["report_id"] not in allowed_reports:
                continue
            if chunk["id"] in seen_ids:
                continue
            seen_ids.add(chunk["id"])
            results.append(
                {
                    "score": float(score),
                    "text": chunk["text"],
                    "report_id": chunk["report_id"],
                    "report_name": chunk["report_name"],
                    "page": chunk["page"],
                }
            )
            if len(results) >= top_k:
                break
        return results

    def list_reports(self) -> List[Dict[str, Any]]:
        return list(self.reports.values())

    def preview_text(self, report_id: str, max_chars: int = 1000) -> str:
        chunks_for_report = [c for c in self.chunks if c["report_id"] == report_id]
        if not chunks_for_report:
            return ""
        text = " ".join(c["text"] for c in chunks_for_report)
        return text[:max_chars]


esg_index = ESGIndex()


def extract_text_from_pdf(file_bytes: bytes) -> List[str]:
    """Extract text but limit pages & chars per page for speed."""
    reader = PdfReader(io.BytesIO(file_bytes))
    pages_text = []

    MAX_PAGES = 80
    MAX_CHARS_PER_PAGE = 6000

    for i, page in enumerate(reader.pages):
        if i >= MAX_PAGES:
            break
        txt = page.extract_text() or ""
        if len(txt) > MAX_CHARS_PER_PAGE:
            txt = txt[:MAX_CHARS_PER_PAGE]
        pages_text.append(txt)

    return pages_text


class QueryRequest(BaseModel):
    question: str
    report_ids: List[str] = []
    top_k: int = 8


class QueryResponse(BaseModel):
    answer: str
    citations: List[Dict[str, Any]]


class SummaryRequest(BaseModel):
    report_id: str


class SummaryResponse(BaseModel):
    report_id: str
    summary_md: str


class MetricsRequest(BaseModel):
    report_id: str


class MetricsResponse(BaseModel):
    report_id: str
    metrics: Dict[str, Any]


class ComplianceRequest(BaseModel):
    report_id: str


class ComplianceResponse(BaseModel):
    report_id: str
    compliance: Dict[str, Any]


class RiskRequest(BaseModel):
    report_id: str


class RiskResponse(BaseModel):
    report_id: str
    score: str
    explanation: str


class ReportsResponse(BaseModel):
    reports: List[Dict[str, Any]]


class PreviewResponse(BaseModel):
    report_id: str
    preview_text: str


app = FastAPI(title="ESG Insight Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"message": "ESG Assistant API running", "docs": "/docs"}


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "model": GEN_MODEL,
        "chunks": len(esg_index.chunks),
        "reports": len(esg_index.reports),
    }


@app.post("/api/reports", response_model=ReportsResponse)
async def upload_reports(files: List[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    for f in files:
        name = f.filename
        content_bytes = await f.read()

        if name.lower().endswith(".pdf"):
            pages = extract_text_from_pdf(content_bytes)
            full_text = "\n\n".join(pages)
            if not full_text.strip():
                raise HTTPException(status_code=400, detail=f"No text extracted from {name}")
            try:
                esg_index.add_report(name=name, content=full_text, pages_text=pages)
            except MemoryError:
                raise HTTPException(
                    status_code=413,
                    detail="This report is too large to process. Please upload a smaller file or a shorter extract.",
                )
        else:
            text = content_bytes.decode("utf-8", errors="ignore")
            try:
                esg_index.add_report(name=name, content=text, pages_text=[text])
            except MemoryError:
                raise HTTPException(
                    status_code=413,
                    detail="This report is too large to process. Please upload a smaller file or a shorter extract.",
                )

    return ReportsResponse(reports=esg_index.list_reports())


@app.post("/api/sample-report", response_model=ReportsResponse)
def load_sample_report():
    sample_text = (
        "ESG REPORT 2024 – AFRIGRID ENERGY PLC. "
        "Afrigrid Energy Plc is a West African electricity generation and distribution company. "
        "Scope 1 emissions: 130000 tCO2e; Scope 2 emissions: 82000 tCO2e; "
        "Scope 3 emissions: 460000 tCO2e. Total energy consumption: 124000 MWh. "
        "Water withdrawals: 98500 m3. Total non-hazardous waste generated: 4300 tonnes. "
        "Total employees: 5100. Board female representation: 36%. "
        "The company references GRI Standards, SASB Electric Utilities & Power Generators, "
        "and partial alignment with IFRS S1 and IFRS S2. The strategy aligns with SDG 7 "
        "(Affordable and Clean Energy) and SDG 13 (Climate Action)."
    )
    esg_index.add_report(
        name="Sample_ESG_Report_2024_Afrigrid.txt",
        content=sample_text,
        pages_text=[sample_text],
    )
    return ReportsResponse(reports=esg_index.list_reports())


@app.get("/api/reports", response_model=ReportsResponse)
def list_reports():
    return ReportsResponse(reports=esg_index.list_reports())


@app.get("/api/reports/{report_id}/preview", response_model=PreviewResponse)
def preview_report(report_id: str):
    if report_id not in esg_index.reports:
        raise HTTPException(status_code=404, detail="Report not found")
    preview = esg_index.preview_text(report_id, max_chars=1000)
    return PreviewResponse(report_id=report_id, preview_text=preview)


@app.post("/api/query", response_model=QueryResponse)
def query_esg(req: QueryRequest):
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question is empty")

    search_results = esg_index.search(
        query=question,
        top_k=req.top_k,
        report_ids=req.report_ids or None,
    )
    if not search_results:
        return QueryResponse(
            answer="I couldn’t find relevant ESG context for that question in the uploaded reports.",
            citations=[],
        )

    context_lines = []
    citations = []
    for i, item in enumerate(search_results, start=1):
        context_lines.append(
            f"[{i}] (Report: {item['report_name']}, page {item['page']})\n{item['text']}"
        )
        citations.append(
            {
                "id": f"c{i}",
                "report_id": item["report_id"],
                "report_name": item["report_name"],
                "page": item["page"],
                "snippet": item["text"][:400],
            }
        )

    context_block = "\n\n".join(context_lines)

    prompt = (
        "You are an ESG and sustainability analysis assistant. "
        "You must answer ONLY using the context below. "
        "If the answer is not clearly supported by the context, say you cannot find it.\n\n"
        f"Context:\n{context_block}\n\n"
        f"Question: {question}\n\n"
        "Answer clearly and concisely. When relevant, refer to context items like [1], [2]."
    )

    try:
        resp = gen_model.generate_content(prompt)
        answer = resp.text.strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API error: {e}")

    return QueryResponse(answer=answer, citations=citations)


@app.post("/api/summary", response_model=SummaryResponse)
def generate_summary(req: SummaryRequest):
    report_id = req.report_id
    if report_id not in esg_index.reports:
        raise HTTPException(status_code=404, detail="Report not found")

    chunks_for_report = [c for c in esg_index.chunks if c["report_id"] == report_id]
    max_chunks = 80
    chunks_for_report = chunks_for_report[:max_chunks]

    context = "\n\n".join(f"(Page {c['page']}) {c['text']}" for c in chunks_for_report)

    prompt = (
        "You are an ESG analyst. Based only on the context below, write a professional, "
        "1-page ESG executive summary of this company's sustainability performance.\n\n"
        "Structure the summary as markdown with the following sections:\n"
        "1. Overview\n"
        "2. Key environmental metrics (CO₂, energy, water, waste)\n"
        "3. Social initiatives\n"
        "4. Governance & risk management\n"
        "5. Strengths\n"
        "6. Gaps and risks\n\n"
        "Be factual and avoid making up data. If a metric is not disclosed, say so.\n\n"
        f"Context:\n{context}\n\n"
        "Now write the markdown summary."
    )

    try:
        resp = gen_model.generate_content(prompt)
        summary_md = resp.text.strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API error: {e}")

    return SummaryResponse(report_id=report_id, summary_md=summary_md)


@app.post("/api/metrics", response_model=MetricsResponse)
def extract_metrics(req: MetricsRequest):
    report_id = req.report_id
    if report_id not in esg_index.reports:
        raise HTTPException(status_code=404, detail="Report not found")

    chunks_for_report = [c for c in esg_index.chunks if c["report_id"] == report_id]
    max_chunks = 80
    chunks_for_report = chunks_for_report[:max_chunks]
    context = "\n\n".join(f"(Page {c['page']}) {c['text']}" for c in chunks_for_report)

    prompt = (
        "You are an ESG data extraction assistant. Based ONLY on the context below, "
        "extract key ESG metrics and return them as strict JSON. Do not include commentary.\n\n"
        "Use this exact JSON structure:\n"
        "{\n"
        '  "emissions": {\n'
        '    "scope1_tco2e": number | null,\n'
        '    "scope2_tco2e": number | null,\n'
        '    "scope3_tco2e": number | null\n'
        "  },\n"
        '  "energy": {\n'
        '    "total_mwh": number | null\n'
        "  },\n"
        '  "water": {\n'
        '    "withdrawals_m3": number | null\n'
        "  },\n"
        '  "waste": {\n'
        '    "total_tonnes": number | null\n'
        "  },\n"
        '  "social": {\n'
        '    "employees_total": number | null\n'
        "  },\n"
        '  "governance": {\n'
        '    "board_female_pct": number | null\n'
        "  }\n"
        "}\n\n"
        "If a value is not clearly stated, use null. Do NOT add any extra top-level fields. "
        "Respond with JSON only, no extra text.\n\n"
        f"Context:\n{context}\n\n"
        "Return JSON now."
    )

    try:
        resp = gen_model.generate_content(prompt)
        raw = resp.text.strip()
        metrics = parse_strict_json(raw)
    except json.JSONDecodeError:
        metrics = {"raw": resp.text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API error: {e}")

    return MetricsResponse(report_id=report_id, metrics=metrics)


@app.post("/api/compliance", response_model=ComplianceResponse)
def compliance_check(req: ComplianceRequest):
    report_id = req.report_id
    if report_id not in esg_index.reports:
        raise HTTPException(status_code=404, detail="Report not found")

    chunks_for_report = [c for c in esg_index.chunks if c["report_id"] == report_id]
    max_chunks = 80
    chunks_for_report = chunks_for_report[:max_chunks]
    context = "\n\n".join(f"(Page {c['page']}) {c['text']}" for c in chunks_for_report)

    prompt = (
        "You are an ESG reporting compliance assistant. Based ONLY on the context below, "
        "assess whether the report discusses or references each of the following:\n"
        "- SDGs (Sustainable Development Goals)\n"
        "- GRI\n"
        "- SASB\n"
        "- IFRS S1\n"
        "- IFRS S2\n\n"
        "Return a strict JSON object with this structure:\n"
        "{\n"
        '  "sdgs": {"covered": boolean, "notes": string},\n'
        '  "gri": {"covered": boolean, "notes": string},\n'
        '  "sasb": {"covered": boolean, "notes": string},\n'
        '  "ifrs_s1": {"covered": boolean, "notes": string},\n'
        '  "ifrs_s2": {"covered": boolean, "notes": string}\n'
        "}\n\n"
        "If you are not sure, set covered to false and explain briefly in notes. "
        "Respond with JSON only, no extra text.\n\n"
        f"Context:\n{context}\n\n"
        "Return JSON now."
    )

    try:
        resp = gen_model.generate_content(prompt)
        raw = resp.text.strip()
        compliance = parse_strict_json(raw)
    except json.JSONDecodeError:
        compliance = {"raw": resp.text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API error: {e}")

    return ComplianceResponse(report_id=report_id, compliance=compliance)


@app.post("/api/risk", response_model=RiskResponse)
def greenwashing_risk(req: RiskRequest):
    report_id = req.report_id
    if report_id not in esg_index.reports:
        raise HTTPException(status_code=404, detail="Report not found")

    chunks_for_report = [c for c in esg_index.chunks if c["report_id"] == report_id]
    max_chunks = 80
    chunks_for_report = chunks_for_report[:max_chunks]
    context = "\n\n".join(f"(Page {c['page']}) {c['text']}" for c in chunks_for_report)

    prompt = (
        "You are an ESG analyst assessing potential greenwashing. Based ONLY on the context below, "
        "assign a simple greenwashing risk label and explanation.\n\n"
        "Choose one of these labels: Low, Medium, High.\n\n"
        "Return a strict JSON object:\n"
        '{\n  "score": "Low" | "Medium" | "High",\n  "explanation": string\n}\n\n'
        "Do not add other fields. Respond with JSON only.\n\n"
        f"Context:\n{context}\n\n"
        "Return JSON now."
    )

    try:
        resp = gen_model.generate_content(prompt)
        raw = resp.text.strip()
        data = parse_strict_json(raw)
        score = str(data.get("score", "Medium"))
        explanation = str(data.get("explanation", ""))
    except json.JSONDecodeError:
        score = "Medium"
        explanation = resp.text
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API error: {e}")

    return RiskResponse(report_id=report_id, score=score, explanation=explanation)
