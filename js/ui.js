/* ==========================================================================
   OhmGuard - User Interface & Coordination Module
   ========================================================================== */

import { AppState, resetFileDataState } from './state.js';
import { parseLTspiceRaw } from './spiceParser.js';
import { evaluateWaveformExpression, calculateWaveformMetrics } from './evaluator.js';
import { extractSpecsFromPDF } from './pdfParser.js';

// --- Toast Notification System ---
export function showToast(msg) {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transition = "opacity 0.3s";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// --- Render Validation Table ---
export function renderValidationTable() {
    const tbody = document.getElementById("tbody-validation");
    tbody.innerHTML = "";

    if (AppState.validationResults.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No validation checks loaded or no file parsed.</td></tr>`;
        return;
    }

    const filter = document.getElementById("filter-status").value;
    const filtered = AppState.validationResults.filter(r => filter === "ALL" || r.status === filter);

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No checks match the selected filter.</td></tr>`;
        return;
    }

    for (const row of filtered) {
        const tr = document.createElement("tr");
        
        let barColor = "hsl(142, 71%, 50%)";
        if (row.status === "WARNING") barColor = "hsl(38, 92%, 50%)";
        if (row.status === "FAIL") barColor = "hsl(0, 84%, 60%)";

        const fillWidth = Math.min(row.stress, 100);

        tr.innerHTML = `
            <td><span class="status-badge status-${row.status}">● ${row.status}</span></td>
            <td><strong>${row.id}</strong></td>
            <td>${row.description}</td>
            <td><code>${row.metric}</code></td>
            <td><strong>${row.simVal.toPrecision(5)}</strong> ${row.unit}</td>
            <td>${row.limit.toPrecision(5)} ${row.unit}</td>
            <td>
                <div class="stress-bar-wrapper">
                    <div class="stress-bar-bg">
                        <div class="stress-bar-fill" style="width: ${fillWidth}%; background: ${barColor};"></div>
                    </div>
                    <span class="stress-val" style="color: ${barColor};">${row.stress.toFixed(1)}%</span>
                </div>
            </td>
            <td><code>${row.expression}</code></td>
        `;
        tbody.appendChild(tr);
    }
}

// --- Render Explorer Table ---
export function renderExplorerTable() {
    const tbody = document.getElementById("tbody-explorer");
    tbody.innerHTML = "";

    if (AppState.explorerResults.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="8">No waveform data loaded. Drop a .raw file above!</td></tr>`;
        return;
    }

    const query = document.getElementById("search-explorer").value.toLowerCase();
    const list = AppState.explorerResults.filter(r => r.name.toLowerCase().includes(query));

    // Sort list
    const { column, ascending } = AppState.currentSort;
    list.sort((a, b) => {
        const valA = a[column];
        const valB = b[column];
        if (typeof valA === 'string') {
            return ascending ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return ascending ? valA - valB : valB - valA;
    });

    for (const row of list) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><code>${row.name}</code></td>
            <td>${row.min.toPrecision(5)}</td>
            <td>${row.max.toPrecision(5)}</td>
            <td><strong>${row.pkpk.toPrecision(5)}</strong></td>
            <td>${row.rms.toPrecision(5)}</td>
            <td>${row.avg.toPrecision(5)}</td>
            <td>${row.unit}</td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="addTraceToSpec('${row.name}', '${row.unit}')">+ Add to SOA Check</button>
            </td>
        </tr>`;
        tbody.appendChild(tr);
    }
}

// --- Render Spec Editor ---
export function renderSpecEditor() {
    const container = document.getElementById("spec-cards-container");
    container.innerHTML = "";

    for (const [compId, comp] of Object.entries(AppState.specs)) {
        const card = document.createElement("div");
        card.className = "spec-card";
        card.innerHTML = `
            <div class="spec-card-header">
                <div class="spec-card-title">🔌 ${compId}</div>
                <button class="btn-icon" onclick="deleteComponentSpec('${compId}')" title="Delete check">✕</button>
            </div>
            <div class="form-group">
                <label>Description</label>
                <input type="text" class="text-input" style="width:100%" value="${comp.description}" onchange="updateSpecField('${compId}', 'description', this.value)">
            </div>
            <div class="form-group">
                <label>Waveform Math Expression</label>
                <input type="text" class="text-input" style="width:100%" value="${comp.expression}" onchange="updateSpecField('${compId}', 'expression', this.value)">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Metric Checked</label>
                    <select class="select-input" onchange="updateSpecField('${compId}', 'metric', this.value)">
                        <option value="max_peak" ${comp.metric === 'max_peak' ? 'selected' : ''}>Max Peak (Upper Limit)</option>
                        <option value="min_peak" ${comp.metric === 'min_peak' ? 'selected' : ''}>Min Peak (Lower Limit)</option>
                        <option value="rms" ${comp.metric === 'rms' ? 'selected' : ''}>RMS (Integrated)</option>
                        <option value="avg" ${comp.metric === 'avg' ? 'selected' : ''}>Average (Thermal)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Spec Limit (${comp.unit || ''})</label>
                    <input type="number" step="any" class="text-input" style="width:100%" value="${comp.limit}" onchange="updateSpecField('${compId}', 'limit', parseFloat(this.value))">
                </div>
            </div>
        `;
        container.appendChild(card);
    }
}

// --- Run Full Analysis Orchestration ---
export function runFullAnalysis() {
    // 1. Run Explorer Analysis (All Variables)
    const explorerList = [];
    for (const v of AppState.variables) {
        if (v.name.toLowerCase() === 'time' || v.name.toLowerCase() === 'frequency') continue;
        
        const wave = AppState.data[v.name];
        const metrics = calculateWaveformMetrics(wave, AppState.timeVector);
        if (!metrics) continue;
        
        let unit = "";
        if (v.type.toLowerCase().includes("voltage")) unit = "V";
        else if (v.type.toLowerCase().includes("current")) unit = "A";
        else unit = v.type;

        explorerList.push({
            name: v.name,
            min: metrics.min,
            max: metrics.max,
            pkpk: metrics.pkpk,
            rms: metrics.rms,
            avg: metrics.avg,
            unit: unit
        });
    }
    AppState.explorerResults = explorerList;

    // 2. Run Design Validation (SOA Derating Checks)
    const validationList = [];
    let passCount = 0;
    let warnCount = 0;
    let failCount = 0;

    for (const [compId, comp] of Object.entries(AppState.specs)) {
        const wave = evaluateWaveformExpression(comp.expression, AppState.data, AppState.numPoints);
        const metrics = calculateWaveformMetrics(wave, AppState.timeVector);
        
        let simVal = 0;
        if (metrics) {
            if (comp.metric === "max_peak") simVal = metrics.max;
            else if (comp.metric === "min_peak") simVal = metrics.min;
            else if (comp.metric === "rms") simVal = metrics.rms;
            else if (comp.metric === "avg") simVal = metrics.avg;
            else simVal = metrics.max;
        }

        const limit = comp.limit || 1;
        let stressPct = 0;
        if (comp.metric === "min_peak") {
            if (limit < 0) {
                stressPct = simVal >= 0 ? 0 : (simVal / limit) * 100;
            } else {
                stressPct = (Math.abs(simVal) / Math.abs(limit)) * 100;
            }
        } else if (comp.metric === "max_peak") {
            if (limit > 0) {
                stressPct = simVal <= 0 ? 0 : (simVal / limit) * 100;
            } else {
                stressPct = (Math.abs(simVal) / Math.abs(limit)) * 100;
            }
        } else {
            stressPct = (Math.abs(simVal) / Math.abs(limit)) * 100;
        }
        
        let status = "PASS";
        if (stressPct > 100) {
            status = "FAIL";
            failCount++;
        } else if (stressPct >= 80) {
            status = "WARNING";
            warnCount++;
        } else {
            status = "PASS";
            passCount++;
        }

        validationList.push({
            id: compId,
            description: comp.description,
            expression: comp.expression,
            metric: comp.metric.toUpperCase().replace("_", " "),
            simVal: simVal,
            limit: limit,
            stress: stressPct,
            status: status,
            unit: comp.unit || ""
        });
    }

    AppState.validationResults = validationList;

    // 3. Update Live Executive Stats
    document.getElementById("count-pass").textContent = passCount;
    document.getElementById("count-warn").textContent = warnCount;
    document.getElementById("count-fail").textContent = failCount;
    document.getElementById("count-total").textContent = explorerList.length;

    document.getElementById("badge-validation").textContent = validationList.length;
    document.getElementById("badge-explorer").textContent = explorerList.length;

    document.getElementById("btn-export-csv").disabled = false;

    // Render Tables
    renderValidationTable();
    renderExplorerTable();
}

// --- File Handling Actions ---
export function handleFileSelect(file) {
    if (file.name.toLowerCase().endsWith(".pdf")) {
        parsePDFDatasheet(file);
        return;
    }
    if (!file.name.toLowerCase().endsWith(".raw")) {
        showToast("⚠️ Please upload an LTspice .raw waveform file or .pdf datasheet.");
        return;
    }

    AppState.fileName = file.name;
    const reader = new FileReader();

    showToast(`⏳ Reading ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)...`);

    reader.onload = (e) => {
        try {
            const buffer = e.target.result;
            const parsed = parseLTspiceRaw(buffer);
            
            AppState.variables = parsed.variables;
            AppState.numPoints = parsed.numPoints;
            AppState.data = parsed.data;
            AppState.isBinary = parsed.isBinary;
            AppState.timeVector = parsed.timeVector;

            updateFileInfoUI();
            runFullAnalysis();
            showToast(`✅ Successfully parsed ${AppState.variables.length} traces across ${AppState.numPoints} points!`);
        } catch (err) {
            console.error(err);
            showToast(`❌ Error parsing file: ${err.message}`);
        }
    };

    reader.readAsArrayBuffer(file);
}

export async function parsePDFDatasheet(file) {
    showToast(`⏳ Reading & Parsing PDF Datasheet (${file.name})...`);

    try {
        const newSpecs = await extractSpecsFromPDF(file, AppState.variables);
        AppState.specs = newSpecs;
        renderSpecEditor();
        if (AppState.variables.length > 0) {
            runFullAnalysis();
        }

        // Switch to Specs Tab
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
        document.querySelector('[data-tab="tab-specs"]').classList.add("active");
        document.getElementById("tab-specs").classList.add("active");

        showToast(`📄 Successfully extracted ${Object.keys(newSpecs).length} Absolute Maximum Ratings from ${file.name} (No LLM needed)!`);
    } catch (err) {
        console.error("Error reading PDF:", err);
        showToast(`❌ Error parsing PDF: ${err.message}`);
    }
}

function updateFileInfoUI() {
    document.getElementById("display-file-name").textContent = AppState.fileName;
    document.getElementById("display-file-meta").textContent = `${AppState.variables.length} Traces | ${AppState.numPoints.toLocaleString()} Points (${AppState.isBinary ? 'Binary' : 'ASCII'})`;
    document.getElementById("file-info").classList.remove("hidden");
    document.querySelector(".drop-content").classList.add("hidden");
}

export function resetFileData() {
    resetFileDataState();

    document.getElementById("file-info").classList.add("hidden");
    document.querySelector(".drop-content").classList.remove("hidden");
    document.getElementById("btn-export-csv").disabled = true;

    renderValidationTable();
    renderExplorerTable();
    showToast("🗑️ Cleared waveform data.");
}

// --- Specification Operations ---
export function addNewComponentSpec() {
    const name = prompt("Enter Component ID (e.g., C_FILTER, Q_SWITCH):", "NEW_COMP");
    if (!name) return;
    
    AppState.specs[name] = {
        description: "Custom design validation check",
        expression: "V(out)",
        metric: "max_peak",
        limit: 15.0,
        unit: "V"
    };
    renderSpecEditor();
    if (AppState.numPoints > 0) runFullAnalysis();
    showToast(`✨ Created check for ${name}`);
}

export function exportSpecJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ components: AppState.specs }, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "ltspice_derating_specs.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("📤 Exported component specifications to JSON!");
}

export function importSpecFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const parsed = JSON.parse(event.target.result);
            if (parsed.components) {
                AppState.specs = parsed.components;
            } else {
                AppState.specs = parsed;
            }
            renderSpecEditor();
            if (AppState.numPoints > 0) runFullAnalysis();
            showToast("📥 Successfully imported component specifications!");
        } catch (err) {
            showToast("❌ Error importing JSON spec: " + err.message);
        }
    };
    reader.readAsText(file);
}

export function exportCSVReport() {
    if (AppState.validationResults.length === 0) return;

    let csv = "Status,Component ID,Description,Parameter Checked,Simulated Value,Spec Limit,Stress / Derating %,Waveform Expression,Unit\n";
    for (const r of AppState.validationResults) {
        csv += `"${r.status}","${r.id}","${r.description}","${r.metric}",${r.simVal},${r.limit},${r.stress.toFixed(2)}%,"${r.expression}","${r.unit}"\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${AppState.fileName.replace(".raw", "")}_soa_report.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("📊 Downloaded comprehensive CSV design validation report!");
}

// --- Attach Action Handlers to window Object for DOM element inline handlers ---
export function updateSpecField(compId, field, value) {
    if (AppState.specs[compId]) {
        AppState.specs[compId][field] = value;
        if (AppState.numPoints > 0) runFullAnalysis();
    }
}

export function deleteComponentSpec(compId) {
    delete AppState.specs[compId];
    renderSpecEditor();
    if (AppState.numPoints > 0) runFullAnalysis();
    showToast(`Removed check for ${compId}`);
}

export function addTraceToSpec(traceName, unit) {
    const compId = `CHECK_${traceName.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`;
    AppState.specs[compId] = {
        description: `Validation check for ${traceName}`,
        expression: traceName,
        metric: "max_peak",
        limit: 10.0,
        unit: unit
    };
    renderSpecEditor();
    if (AppState.numPoints > 0) runFullAnalysis();
    
    document.querySelector('[data-tab="tab-specs"]').click();
    showToast(`✨ Added ${compId} to Component Spec Editor!`);
}

window.updateSpecField = updateSpecField;
window.deleteComponentSpec = deleteComponentSpec;
window.addTraceToSpec = addTraceToSpec;

// --- Initialize Event Listeners ---
export function initUI() {
    const dropzone = document.getElementById("dropzone");
    const fileInput = document.getElementById("file-input");
    const removeBtn = document.getElementById("btn-remove-file");

    dropzone.addEventListener("click", (e) => {
        if (!e.target.closest("#btn-remove-file")) {
            fileInput.click();
        }
    });

    dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
    });

    dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("dragover");
    });

    dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener("change", (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        resetFileData();
    });

    // Tab Navigation
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
            
            btn.classList.add("active");
            document.getElementById(btn.dataset.tab).classList.add("active");
        });
    });

    // Header Actions
    document.getElementById("btn-import-pdf").addEventListener("click", () => {
        document.getElementById("file-import-pdf").click();
    });
    document.getElementById("file-import-pdf").addEventListener("change", (e) => {
        if (e.target.files.length > 0) {
            parsePDFDatasheet(e.target.files[0]);
        }
    });
    document.getElementById("btn-export-csv").addEventListener("click", exportCSVReport);

    // Filters & Search
    document.getElementById("filter-status").addEventListener("change", renderValidationTable);
    document.getElementById("search-explorer").addEventListener("input", renderExplorerTable);

    // Explorer Sorting
    document.querySelectorAll("#table-explorer th.sortable").forEach(th => {
        th.addEventListener("click", () => {
            const col = th.dataset.sort;
            if (AppState.currentSort.column === col) {
                AppState.currentSort.ascending = !AppState.currentSort.ascending;
            } else {
                AppState.currentSort.ascending = (col === "name");
                AppState.currentSort.column = col;
            }
            renderExplorerTable();
        });
    });

    // Spec Editor Actions
    document.getElementById("btn-add-comp").addEventListener("click", addNewComponentSpec);
    document.getElementById("btn-export-spec").addEventListener("click", exportSpecJSON);
    document.getElementById("btn-import-spec").addEventListener("click", () => {
        document.getElementById("file-import-spec").click();
    });
    document.getElementById("file-import-spec").addEventListener("change", importSpecFile);

    // Initial renders
    renderSpecEditor();
    renderValidationTable();
    renderExplorerTable();
}
