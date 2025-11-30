const API_BASE = "https://esg-analyzer.onrender.com";

let selectedReportId = null;
let reportsCache = [];

// ---------- Helper: simple fetch wrapper ----------
async function apiFetch(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

// ---------- DOM helpers ----------
const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const sampleBtn = document.getElementById("sampleBtn");
const uploadStatus = document.getElementById("uploadStatus");
const uploadProgress = document.getElementById("uploadProgress");

const reportsList = document.getElementById("reportsList");
const previewBox = document.getElementById("previewBox");

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

const refreshReportsBtn = document.getElementById("refreshReports");

// ---------- Tabs ----------
const tabButtons = document.querySelectorAll(".tab-btn");
const tabChat = document.getElementById("tab-chat");
const tabSummary = document.getElementById("tab-summary");
const tabMetrics = document.getElementById("tab-metrics");

tabButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    tabButtons.forEach(b => {
      b.classList.remove("border-emerald-400", "text-emerald-300");
      b.classList.add("text-slate-400");
    });
    btn.classList.add("border-emerald-400", "text-emerald-300");
    btn.classList.remove("text-slate-400");

    const tab = btn.getAttribute("data-tab");
    tabChat.classList.toggle("hidden", tab !== "chat");
    tabSummary.classList.toggle("hidden", tab !== "summary");
    tabMetrics.classList.toggle("hidden", tab !== "metrics");
  });
});

// ---------- Reports list ----------
async function loadReports() {
  try {
    const data = await apiFetch("/api/reports");
    reportsCache = data.reports || [];
    renderReportsList();
  } catch (err) {
    console.error(err);
    reportsList.innerHTML = `<div class="text-red-400 text-[11px]">Failed to load reports</div>`;
  }
}

function renderReportsList() {
  reportsList.innerHTML = "";

  if (!reportsCache.length) {
    reportsList.innerHTML = `<div class="text-slate-500 text-[11px]">No reports uploaded yet.</div>`;
    return;
  }

  reportsCache.forEach(report => {
    const btn = document.createElement("button");
    btn.className =
      "w-full text-left px-2 py-1 rounded-lg hover:bg-slate-800/70 flex flex-col border border-transparent text-[11px]";
    if (report.id === selectedReportId) {
      btn.classList.add("bg-slate-800", "border-emerald-500/40");
    }
    btn.innerHTML = `
      <div class="font-semibold text-slate-100">${report.name}</div>
      <div class="text-[10px] text-slate-400">Pages: ${report.pages ?? "?"}</div>
    `;
    btn.addEventListener("click", () => {
      selectedReportId = report.id;
      renderReportsList();
      loadPreview(report.id);
      setActionButtonsDisabled(false);
    });
    reportsList.appendChild(btn);
  });
}

async function loadPreview(reportId) {
  previewBox.textContent = "Loading preview...";
  try {
    const data = await apiFetch(`/api/reports/${encodeURIComponent(reportId)}/preview`);
    previewBox.textContent = data.preview_text || "No preview text available.";
  } catch (err) {
    console.error(err);
    previewBox.textContent = "Failed to load preview.";
  }
}

function setActionButtonsDisabled(disabled) {
  generateSummaryBtn.disabled = disabled;
  downloadSummaryBtn.disabled = disabled || !summaryBox.textContent.trim();
  runComplianceBtn.disabled = disabled;
  runRiskBtn.disabled = disabled;
  extractMetricsBtn.disabled = disabled;
}

// ---------- Upload handling ----------
uploadBtn.addEventListener("click", async () => {
  if (!fileInput.files.length) {
    alert("Please select at least one ESG report (PDF or .txt)");
    return;
  }

  const formData = new FormData();
  Array.from(fileInput.files).forEach(file => {
    formData.append("files", file);
  });

  uploadBtn.disabled = true;
  uploadStatus.textContent = "Uploading...";
  uploadProgress.textContent = "";

  try {
    const res = await fetch(API_BASE + "/api/reports", {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    uploadStatus.textContent = "Done ✓";
    uploadProgress.textContent = `Indexed ${data.reports.length} report(s).`;

    reportsCache = data.reports;
    renderReportsList();
  } catch (err) {
    console.error(err);
    uploadStatus.textContent = "Error";
    uploadProgress.textContent = "Upload failed.";
    alert("Upload failed. Check console for details.");
  } finally {
    uploadBtn.disabled = false;
  }
});

sampleBtn.addEventListener("click", async () => {
  sampleBtn.disabled = true;
  sampleBtn.textContent = "Loading sample...";
  try {
    const data = await apiFetch("/api/sample-report", { method: "POST" });
    uploadStatus.textContent = "Sample loaded ✓";
    reportsCache = data.reports;
    renderReportsList();
  } catch (err) {
    console.error(err);
    alert("Failed to load sample report.");
  } finally {
    sampleBtn.disabled = false;
    sampleBtn.textContent = "Try with sample ESG report";
  }
});

refreshReportsBtn.addEventListener("click", loadReports);

// ---------- Chat ----------
function appendChatBubble(sender, text) {
  const div = document.createElement("div");
  div.className = "rounded-xl px-3 py-2 max-w-[90%] text-[11px] whitespace-pre-wrap";
  if (sender === "user") {
    div.classList.add("bg-emerald-500/10", "border", "border-emerald-500/40", "ml-auto");
  } else {
    div.classList.add("bg-slate-900", "border", "border-slate-700");
  }
  div.textContent = text;
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = chatInput.value.trim();
  if (!question) return;
  if (!selectedReportId) {
    alert("Select or upload a report first.");
    return;
  }

  appendChatBubble("user", question);
  chatInput.value = "";

  appendChatBubble("assistant", "Thinking...");
  const thinkingBubble = chatWindow.lastChild;

  try {
    const data = await apiFetch("/api/query", {
      method: "POST",
      body: JSON.stringify({
        question,
        report_ids: [selectedReportId],
        top_k: 8
      })
    });

    thinkingBubble.textContent = data.answer || "No answer returned.";

    if (data.citations && data.citations.length) {
      const cit = document.createElement("div");
      cit.className = "text-[10px] text-slate-400 mt-1";
      cit.textContent =
        "Citations: " +
        data.citations
          .map(c => `${c.report_name} (p.${c.page})`)
          .join(" • ");
      chatWindow.appendChild(cit);
    }
  } catch (err) {
    console.error(err);
    thinkingBubble.textContent = "Error calling ESG chat API.";
  }
});

// ---------- Summary + PDF ----------
generateSummaryBtn.addEventListener("click", async () => {
  if (!selectedReportId) {
    alert("Select or upload a report first.");
    return;
  }
  summaryBox.textContent = "Generating summary...";
  try {
    const data = await apiFetch("/api/summary", {
      method: "POST",
      body: JSON.stringify({ report_id: selectedReportId })
    });
    summaryBox.textContent = data.summary_md || "No summary generated.";
    downloadSummaryBtn.disabled = false;
  } catch (err) {
    console.error(err);
    summaryBox.textContent = "Failed to generate summary.";
  }
});

downloadSummaryBtn.addEventListener("click", () => {
  if (!summaryBox.textContent.trim()) return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const lines = doc.splitTextToSize(summaryBox.textContent, 180);
  doc.text(lines, 10, 10);
  doc.save("esg_summary.pdf");
});

// ---------- Compliance ----------
runComplianceBtn.addEventListener("click", async () => {
  if (!selectedReportId) {
    alert("Select or upload a report first.");
    return;
  }
  complianceBox.innerHTML = `<div class="text-slate-400">Running compliance check...</div>`;
  try {
    const data = await apiFetch("/api/compliance", {
      method: "POST",
      body: JSON.stringify({ report_id: selectedReportId })
    });

    const c = data.compliance || {};
    const items = [
      ["SDGs", c.sdgs],
      ["GRI", c.gri],
      ["SASB", c.sasb],
      ["IFRS S1", c.ifrs_s1],
      ["IFRS S2", c.ifrs_s2]
    ];

    complianceBox.innerHTML = "";
    items.forEach(([label, obj]) => {
      if (!obj) return;
      const row = document.createElement("div");
      row.className =
        "flex items-start justify-between gap-2 border-b border-slate-800/80 pb-1 mb-1";
      row.innerHTML = `
        <div class="font-semibold text-slate-100">${label}</div>
        <div class="text-right text-[11px]">
          <div class="${obj.covered ? "text-emerald-300" : "text-slate-300"}">
            ${obj.covered ? "Covered" : "Not clearly covered"}
          </div>
          <div class="text-slate-400 mt-0.5 whitespace-pre-wrap">
            ${obj.notes || ""}
          </div>
        </div>
      `;
      complianceBox.appendChild(row);
    });

    if (!complianceBox.innerHTML.trim()) {
      complianceBox.innerHTML = `<div class="text-slate-400 text-[11px]">No compliance info returned.</div>`;
    }
  } catch (err) {
    console.error(err);
    complianceBox.innerHTML = `<div class="text-red-400 text-[11px]">Failed to run compliance check.</div>`;
  }
});

// ---------- Risk (greenwashing) ----------
runRiskBtn.addEventListener("click", async () => {
  if (!selectedReportId) {
    alert("Select or upload a report first.");
    return;
  }
  riskBox.innerHTML =
    `<p class="text-slate-400 text-[11px]">Assessing greenwashing risk...</p>`;
  try {
    const data = await apiFetch("/api/risk", {
      method: "POST",
      body: JSON.stringify({ report_id: selectedReportId })
    });

    riskBox.innerHTML = "";
    const badgeColor =
      data.score === "High"
        ? "bg-red-500/20 text-red-300 border-red-500/50"
        : data.score === "Medium"
        ? "bg-amber-500/20 text-amber-300 border-amber-500/50"
        : "bg-emerald-500/20 text-emerald-300 border-emerald-500/50";

    const badge = document.createElement("div");
    badge.className =
      "inline-flex items-center gap-2 px-2 py-1 rounded-full border text-[11px] " +
      badgeColor;
    badge.innerHTML = `<span class="font-semibold">Greenwashing risk:</span> ${data.score}`;
    const expl = document.createElement("p");
    expl.className = "mt-2 text-[11px] text-slate-200 whitespace-pre-wrap";
    expl.textContent = data.explanation || "";

    riskBox.appendChild(badge);
    riskBox.appendChild(expl);
  } catch (err) {
    console.error(err);
    riskBox.innerHTML =
      `<p class="text-red-400 text-[11px]">Failed to assess greenwashing risk.</p>`;
  }
});

// ---------- Metrics ----------
extractMetricsBtn.addEventListener("click", async () => {
  if (!selectedReportId) {
    alert("Select or upload a report first.");
    return;
  }
  metricsBox.textContent = "Extracting metrics...";
  try {
    const data = await apiFetch("/api/metrics", {
      method: "POST",
      body: JSON.stringify({ report_id: selectedReportId })
    });

    metricsBox.textContent = JSON.stringify(data.metrics, null, 2);
  } catch (err) {
    console.error(err);
    metricsBox.textContent = "Failed to extract metrics.";
  }
});

// ---------- Init ----------
window.addEventListener("load", async () => {
  setActionButtonsDisabled(true);
  await loadReports();
});
