const API_BASE = "https://esg-analyzer.onrender.com";
let selectedReportId = null;
let currentSummaryText = "";

const tabButtons = document.querySelectorAll(".tab-btn");
const tabChat = document.getElementById("tab-chat");
const tabSummary = document.getElementById("tab-summary");
const tabMetrics = document.getElementById("tab-metrics");

tabButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.getAttribute("data-tab");
    tabButtons.forEach(b => {
      b.classList.remove("border-b-2", "border-emerald-400", "text-emerald-300");
      b.classList.add("text-slate-400");
    });
    btn.classList.add("border-b-2", "border-emerald-400", "text-emerald-300");
    btn.classList.remove("text-slate-400");
    tabChat.classList.add("hidden");
    tabSummary.classList.add("hidden");
    tabMetrics.classList.add("hidden");
    if (tab === "chat") tabChat.classList.remove("hidden");
    if (tab === "summary") tabSummary.classList.remove("hidden");
    if (tab === "metrics") tabMetrics.classList.remove("hidden");
  });
});

const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const sampleBtn = document.getElementById("sampleBtn");
const uploadStatus = document.getElementById("uploadStatus");
const uploadProgress = document.getElementById("uploadProgress");
const reportsList = document.getElementById("reportsList");
const previewBox = document.getElementById("previewBox");
const refreshReports = document.getElementById("refreshReports");

const chatWindow = document.getElementById("chatWindow");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

const generateSummaryBtn = document.getElementById("generateSummaryBtn");
const downloadSummaryBtn = document.getElementById("downloadSummaryBtn");
const summaryBox = document.getElementById("summaryBox");

const runComplianceBtn = document.getElementById("runComplianceBtn");
const complianceBox = document.getElementById("complianceBox");

const runRiskBtn = document.getElementById("runRiskBtn");
const riskBox = document.getElementById("riskBox");

const extractMetricsBtn = document.getElementById("extractMetricsBtn");
const metricsBox = document.getElementById("metricsBox");

function setUploadingState(isUploading) {
  uploadBtn.disabled = isUploading;
  sampleBtn.disabled = isUploading;
  uploadStatus.textContent = isUploading ? "Analyzing..." : "";
  uploadProgress.textContent = isUploading ? "Extracting text, indexing and preparing insights..." : "";
}

function appendChatBubble(sender, text, citations) {
  const wrapper = document.createElement("div");
  wrapper.className = "flex flex-col gap-1";
  const bubble = document.createElement("div");
  const base = "max-w-[85%] px-3 py-2 rounded-2xl text-[11px] whitespace-pre-wrap";
  if (sender === "user") {
    wrapper.classList.add("items-end");
    bubble.className = base + " bg-emerald-500 text-slate-950 rounded-br-sm";
  } else {
    wrapper.classList.add("items-start");
    bubble.className = base + " bg-slate-800 text-slate-50 rounded-bl-sm";
  }
  bubble.textContent = text;
  wrapper.appendChild(bubble);
  if (sender === "ai" && citations && citations.length) {
    const cites = document.createElement("div");
    cites.className = "flex flex-wrap gap-1 mt-0.5";
    citations.forEach(c => {
      const chip = document.createElement("div");
      chip.className = "px-2 py-1 rounded-full bg-slate-900/80 border border-slate-700 text-[10px] text-slate-300";
      chip.textContent = `${c.report_name} · p.${c.page}`;
      chip.title = c.snippet;
      cites.appendChild(chip);
    });
    wrapper.appendChild(cites);
  }
  chatWindow.appendChild(wrapper);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

async function fetchReports() {
  try {
    const res = await fetch(API_BASE + "/api/reports");
    const data = await res.json();
    renderReports(data.reports || []);
  } catch (e) {
    console.error(e);
  }
}

function renderReports(reports) {
  reportsList.innerHTML = "";
  if (!reports.length) {
    reportsList.innerHTML = '<div class="text-[11px] text-slate-500">No reports yet. Upload or try the sample.</div>';
    return;
  }
  reports.forEach(r => {
    const label = document.createElement("label");
    label.className = "flex items-center gap-2 cursor-pointer hover:bg-slate-800/80 px-2 py-1 rounded-xl";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "report";
    input.value = r.id;
    input.className = "accent-emerald-500";
    input.addEventListener("change", () => {
      selectedReportId = r.id;
      loadPreview(r.id);
    });
    const text = document.createElement("div");
    text.className = "flex-1 flex flex-col";
    const name = document.createElement("div");
    name.className = "text-[11px] truncate";
    name.textContent = r.name;
    const meta = document.createElement("div");
    meta.className = "text-[10px] text-slate-500";
    meta.textContent = `Pages (approx): ${r.pages} · Uploaded: ${new Date(r.uploaded_at).toLocaleString()}`;
    text.appendChild(name);
    text.appendChild(meta);
    label.appendChild(input);
    label.appendChild(text);
    reportsList.appendChild(label);
  });
}

async function loadPreview(reportId) {
  previewBox.textContent = "Loading preview...";
  try {
    const res = await fetch(`${API_BASE}/api/reports/${reportId}/preview`);
    const data = await res.json();
    previewBox.textContent = data.preview_text || "No preview text available.";
  } catch (e) {
    previewBox.textContent = "Failed to load preview.";
  }
}

fileInput.addEventListener("click", () => {
  fileInput.value = "";
});

uploadBtn.addEventListener("click", async () => {
  if (!fileInput.files.length) {
    alert("Please choose at least one ESG report file (PDF or text).");
    return;
  }
  const formData = new FormData();
  for (const f of fileInput.files) formData.append("files", f);
  setUploadingState(true);
  try {
    const res = await fetch(API_BASE + "/api/reports", { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Upload failed");
    uploadProgress.textContent = "Indexed successfully. You can now chat, summarize, or extract metrics.";
    fetchReports();
  } catch (e) {
    console.error(e);
    alert("Upload failed: " + e.message);
  } finally {
    setUploadingState(false);
  }
});

sampleBtn.addEventListener("click", async () => {
  setUploadingState(true);
  try {
    const res = await fetch(API_BASE + "/api/sample-report", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Failed to load sample");
    uploadProgress.textContent = "Sample report loaded. Select it and start exploring.";
    fetchReports();
  } catch (e) {
    console.error(e);
    alert("Could not load sample report: " + e.message);
  } finally {
    setUploadingState(false);
  }
});

refreshReports.addEventListener("click", fetchReports);

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = chatInput.value.trim();
  if (!question) return;
  if (!selectedReportId) {
    alert("Please select a report first.");
    return;
  }
  appendChatBubble("user", question);
  chatInput.value = "";
  const thinkingBubbleId = "thinking-bubble";
  appendChatBubble("ai", "Thinking...", []);
  const thinkingBubble = chatWindow.lastChild;
  try {
    const res = await fetch(API_BASE + "/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, report_ids: [selectedReportId], top_k: 8 }),
    });
    const data = await res.json().catch(() => ({}));
    chatWindow.removeChild(thinkingBubble);
    if (!res.ok) throw new Error(data.detail || "Query failed");
    appendChatBubble("ai", data.answer || "No answer.", data.citations || []);
  } catch (e2) {
    console.error(e2);
    chatWindow.removeChild(thinkingBubble);
    appendChatBubble("ai", "Something went wrong answering that question: " + e2.message);
  }
});

generateSummaryBtn.addEventListener("click", async () => {
  if (!selectedReportId) {
    alert("Please select a report first.");
    return;
  }
  generateSummaryBtn.disabled = true;
  summaryBox.textContent = "Generating executive summary...";
  try {
    const res = await fetch(API_BASE + "/api/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_id: selectedReportId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Failed to generate summary");
    currentSummaryText = data.summary_md || "";
    summaryBox.textContent = currentSummaryText || "No summary returned.";
    downloadSummaryBtn.disabled = !currentSummaryText;
  } catch (e) {
    console.error(e);
    summaryBox.textContent = "Failed to generate summary: " + e.message;
  } finally {
    generateSummaryBtn.disabled = false;
  }
});

downloadSummaryBtn.addEventListener("click", () => {
  if (!currentSummaryText) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const margins = 14;
  const lines = doc.splitTextToSize(currentSummaryText, 180);
  let y = margins;
  lines.forEach(line => {
    if (y > 280) {
      doc.addPage();
      y = margins;
    }
    doc.text(line, margins, y);
    y += 5;
  });
  doc.save("esg_summary.pdf");
});

runComplianceBtn.addEventListener("click", async () => {
  if (!selectedReportId) {
    alert("Please select a report first.");
    return;
  }
  runComplianceBtn.disabled = true;
  complianceBox.innerHTML = '<p class="text-slate-400">Running compliance check...</p>';
  try {
    const res = await fetch(API_BASE + "/api/compliance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_id: selectedReportId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Compliance check failed");
    const comp = data.compliance || {};
    const items = [
      ["sdgs", "UN SDGs"],
      ["gri", "GRI"],
      ["sasb", "SASB"],
      ["ifrs_s1", "IFRS S1"],
      ["ifrs_s2", "IFRS S2"],
    ];
    complianceBox.innerHTML = "";
    items.forEach(([key, label]) => {
      const row = document.createElement("div");
      row.className = "flex items-start justify-between gap-2 border-b border-slate-800/60 py-1";
      const left = document.createElement("div");
      left.className = "flex-1";
      const title = document.createElement("div");
      title.className = "font-semibold text-[11px]";
      title.textContent = label;
      const notes = document.createElement("div");
      notes.className = "text-[11px] text-slate-400";
      notes.textContent = comp[key]?.notes || "No notes.";
      left.appendChild(title);
      left.appendChild(notes);
      const badge = document.createElement("span");
      const covered = !!comp[key]?.covered;
      badge.className =
        "px-2 py-0.5 rounded-full text-[10px] border " +
        (covered
          ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/50"
          : "bg-slate-900 text-slate-300 border-slate-600");
      badge.textContent = covered ? "Covered" : "Not clear";
      row.appendChild(left);
      row.appendChild(badge);
      complianceBox.appendChild(row);
    });
  } catch (e) {
    console.error(e);
    complianceBox.innerHTML = '<p class="text-red-400 text-[11px]">Error: ' + e.message + "</p>";
  } finally {
    runComplianceBtn.disabled = false;
  }
});

runRiskBtn.addEventListener("click", async () => {
  if (!selectedReportId) {
    alert("Please select a report first.");
    return;
  }
  runRiskBtn.disabled = true;
  riskBox.innerHTML = '<p class="text-slate-400 text-[11px]">Assessing risk...</p>';
  try {
    const res = await fetch(API_BASE + "/api/risk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_id: selectedReportId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Risk assessment failed");
    const score = (data.score || "Medium").toLowerCase();
    const expl = data.explanation || "";
    let colorClass = "bg-amber-500/10 text-amber-300 border-amber-500/60";
    if (score === "low") colorClass = "bg-emerald-500/10 text-emerald-300 border-emerald-500/60";
    else if (score === "high") colorClass = "bg-red-500/10 text-red-300 border-red-500/60";
    riskBox.innerHTML = "";
    const row = document.createElement("div");
    row.className = "space-y-1";
    const badge = document.createElement("div");
    badge.className =
      "inline-flex items-center gap-1 px-3 py-1 rounded-full border text-[11px] font-semibold " +
      colorClass;
    badge.textContent = "Greenwashing risk: " + (score.charAt(0).toUpperCase() + score.slice(1));
    const notes = document.createElement("div");
    notes.className = "text-[11px] text-slate-200";
    notes.textContent = expl;
    row.appendChild(badge);
    row.appendChild(notes);
    riskBox.appendChild(row);
  } catch (e) {
    console.error(e);
    riskBox.innerHTML = '<p class="text-red-400 text-[11px]">Error: ' + e.message + "</p>";
  } finally {
    runRiskBtn.disabled = false;
  }
});

extractMetricsBtn.addEventListener("click", async () => {
  if (!selectedReportId) {
    alert("Please select a report first.");
    return;
  }
  extractMetricsBtn.disabled = true;
  metricsBox.textContent = "Extracting metrics...";
  try {
    const res = await fetch(API_BASE + "/api/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_id: selectedReportId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Metrics extraction failed");
    metricsBox.textContent = JSON.stringify(data.metrics || {}, null, 2);
  } catch (e) {
    console.error(e);
    metricsBox.textContent = "Error: " + e.message;
  } finally {
    extractMetricsBtn.disabled = false;
  }
});

fetchReports();
