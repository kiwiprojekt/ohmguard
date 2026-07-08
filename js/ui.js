/* ==========================================================================
   OhmGuard - User Interface & Coordination Module
   ========================================================================== */

import { AppState, resetFileDataState } from './state.js';
import { parseLTspiceRaw } from './spiceParser.js';
import { evaluateWaveformExpression, calculateWaveformMetrics, resolveFallbackExpression } from './evaluator.js';
import { extractSpecsFromPDF, extractSpecsWithGemini } from './pdfParser.js';

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
        
        let barColor = "#1ABE71";
        if (row.status === "WARNING") barColor = "#F5A623";
        if (row.status === "FAIL" || row.status === "ERROR") barColor = "#EF4444";
        if (row.status === "UNPROBED") barColor = "#94A3B8";

        const fillWidth = Math.min(row.stress, 100);

        let simValStr = "Error";
        if (row.simVal !== null && !isNaN(row.simVal)) {
            simValStr = `<strong>${row.simVal.toPrecision(5)}</strong>`;
        } else if (row.status === "UNPROBED") {
            simValStr = `<span style="color: var(--color-text-muted);">Not in RAW</span>`;
        } else {
            simValStr = `<strong style="color: var(--color-danger);">Error</strong>`;
        }
        
        let limitStr = "N/A";
        if (row.limit !== null && !isNaN(row.limit)) {
            limitStr = `${row.limit.toPrecision(5)}`;
        }

        let stressBarHTML = "";
        if (row.status === "ERROR") {
            stressBarHTML = `<span style="color: var(--color-danger); font-weight: 600; font-size: 0.78rem;">Evaluation Failed</span>`;
        } else if (row.status === "UNPROBED") {
            stressBarHTML = `<span style="color: var(--color-text-muted); font-size: 0.78rem;">Pin/Net not probed in RAW</span>`;
        } else {
            stressBarHTML = `
                <div class="stress-bar-bg">
                    <div class="stress-bar-fill" style="width: ${fillWidth}%; background-color: ${barColor};"></div>
                </div>
                <span class="stress-val" style="color: ${barColor};">${row.stress.toFixed(1)}%</span>
            `;
        }

        let exprCellHTML = `<code>${row.expression}</code>`;
        if (AppState.variables && AppState.variables.length > 0) {
            const options = AppState.variables.map(v => `<option value="${v.name}" ${row.expression === v.name ? 'selected' : ''}>${v.name}</option>`).join("");
            exprCellHTML = `
                <div style="display: flex; align-items: center; gap: 6px; justify-content: space-between;">
                    <code style="flex: 1; word-break: break-all;">${row.expression}</code>
                    <select class="trace-map-select" onchange="window.mapSpecTrace('${row.id}', this.value)" title="Override or map schematic trace for this check" style="padding: 2px 6px; font-size: 0.75rem; border-radius: 4px; border: 1px solid var(--color-border); background: var(--color-bg-secondary); color: var(--color-text); cursor: pointer;">
                        <option value="">🔗 Map...</option>
                        ${options}
                    </select>
                </div>
            `;
        }

        tr.innerHTML = `
            <td><span class="status-badge status-${row.status}">● ${row.status}</span></td>
            <td><strong>${row.id}</strong></td>
            <td>${row.description}</td>
            <td><code>${row.metric}</code></td>
            <td>${simValStr} ${row.unit}</td>
            <td>${limitStr} ${row.unit}</td>
            <td>
                <div class="stress-bar-wrapper">
                    ${stressBarHTML}
                </div>
            </td>
            <td>${exprCellHTML}</td>
        `;
        tbody.appendChild(tr);
    }
}

export function mapSpecTrace(compId, newTrace) {
    if (!newTrace || !AppState.specs[compId]) return;
    AppState.specs[compId].expression = newTrace;
    saveState();
    runFullAnalysis();
    showToast(`🔗 Mapped check ${compId} to trace ${newTrace}`);
}
window.mapSpecTrace = mapSpecTrace;

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
                <button class="btn btn-secondary" onclick="addTraceToSpec('${row.name}', '${row.unit}')" style="width: 100%;">+ Add Check</button>
            </td>
        </tr>`;
        tbody.appendChild(tr);
    }
}

// --- Render Spec Editor ---
export function renderSpecEditor() {
    const tbody = document.getElementById("tbody-specs");
    tbody.innerHTML = "";

    if (Object.keys(AppState.specs).length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="7">No specification checks defined. Create a check or import a spec file.</td></tr>`;
        return;
    }

    for (const [compId, comp] of Object.entries(AppState.specs)) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>
                <input type="text" class="text-input" style="width: 100%; font-family: var(--font-mono); font-weight: 600;" value="${compId}" onchange="renameSpecCompId('${compId}', this.value)">
            </td>
            <td>
                <input type="text" class="text-input" style="width: 100%;" value="${comp.description}" onchange="updateSpecField('${compId}', 'description', this.value)">
            </td>
            <td>
                <input type="text" class="text-input" style="width: 100%; font-family: var(--font-mono);" value="${comp.expression}" onchange="updateSpecField('${compId}', 'expression', this.value)">
            </td>
            <td>
                <select class="select-input" style="width: 100%;" onchange="updateSpecField('${compId}', 'metric', this.value)">
                    <option value="max_peak" ${comp.metric === 'max_peak' ? 'selected' : ''}>Max Peak</option>
                    <option value="min_peak" ${comp.metric === 'min_peak' ? 'selected' : ''}>Min Peak</option>
                    <option value="rms" ${comp.metric === 'rms' ? 'selected' : ''}>RMS</option>
                    <option value="avg" ${comp.metric === 'avg' ? 'selected' : ''}>Average</option>
                </select>
            </td>
            <td>
                <input type="number" step="any" class="text-input" style="width: 100%; font-family: var(--font-mono);" value="${comp.limit}" onchange="updateSpecField('${compId}', 'limit', parseFloat(this.value))">
            </td>
            <td>
                <input type="text" class="text-input" style="width: 100%; text-align: center;" value="${comp.unit || ''}" onchange="updateSpecField('${compId}', 'unit', this.value)">
            </td>
            <td style="text-align: center;">
                <button class="btn-icon-danger" onclick="deleteComponentSpec('${compId}')" title="Delete check">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    }
}

export function renameSpecCompId(oldCompId, newCompId) {
    newCompId = newCompId.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    if (!newCompId || oldCompId === newCompId) return;
    if (AppState.specs[newCompId]) {
        showToast("⚠️ Component ID already exists.");
        renderSpecEditor();
        return;
    }
    AppState.specs[newCompId] = AppState.specs[oldCompId];
    delete AppState.specs[oldCompId];
    renderSpecEditor();
    if (AppState.numPoints > 0) runFullAnalysis();
}
window.renameSpecCompId = renameSpecCompId;



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
        const resolvedExpr = resolveFallbackExpression(comp.expression, AppState.data);
        const wave = evaluateWaveformExpression(resolvedExpr, AppState.data, AppState.numPoints);
        const metrics = calculateWaveformMetrics(wave, AppState.timeVector);
        
        let simVal = 0;
        let stressPct = 0;
        let status = "PASS";

        if (metrics) {
            if (comp.metric === "max_peak") simVal = metrics.max;
            else if (comp.metric === "min_peak") simVal = metrics.min;
            else if (comp.metric === "rms") simVal = metrics.rms;
            else if (comp.metric === "avg") simVal = metrics.avg;
            else simVal = metrics.max;

            const limit = comp.limit || 1;
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
        } else {
            status = "UNPROBED";
            simVal = null;
            stressPct = 0;
        }

        validationList.push({
            id: compId,
            description: comp.description,
            expression: resolvedExpr,
            metric: comp.metric.toUpperCase().replace("_", " "),
            simVal: simVal,
            limit: comp.limit || 0,
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

export async function parsePDFDatasheet(file, forceMethod = null) {
    const method = forceMethod || (AppState.useAI && AppState.apiKey ? "AI" : "Local");
    
    // Find or add file entry in state
    let fileEntry = AppState.loadedSpecFiles.find(f => f.name === file.name);
    if (!fileEntry) {
        fileEntry = {
            name: file.name,
            type: "PDF",
            count: 0,
            status: "parsing",
            error: null,
            fileObject: file,
            parseMethod: method
        };
        AppState.loadedSpecFiles.push(fileEntry);
    } else {
        fileEntry.status = "parsing";
        fileEntry.error = null;
        fileEntry.parseMethod = method;
    }
    
    // Cache file reference on window for retry capability
    window.loadedSpecFileObjects = window.loadedSpecFileObjects || {};
    window.loadedSpecFileObjects[file.name] = file;

    renderFilesListUI();
    showToast(`⏳ Parsing PDF Datasheet ${file.name} using ${method} method...`);

    try {
        let newSpecs;
        if (method === "AI") {
            if (!AppState.apiKey) {
                throw new Error("Gemini API key is not configured in Settings.");
            }
            newSpecs = await extractSpecsWithGemini(file, AppState.variables, AppState.apiKey, AppState.modelName);
        } else {
            newSpecs = await extractSpecsFromPDF(file, AppState.variables);
        }

        // Clean up previously parsed specs from this SAME file to avoid duplicates
        for (const compId of Object.keys(AppState.specs)) {
            if (AppState.specs[compId].sourceFile === file.name) {
                delete AppState.specs[compId];
            }
        }

        // Tag new specs with source file and parse method
        for (const spec of Object.values(newSpecs)) {
            spec.sourceFile = file.name;
            spec.parseMethod = method;
        }

        // Merge with existing specs
        AppState.specs = Object.assign({}, AppState.specs, newSpecs);

        fileEntry.status = "success";
        fileEntry.count = Object.keys(newSpecs).length;

        renderSpecEditor();
        renderFilesListUI();
        if (AppState.variables.length > 0) {
            runFullAnalysis();
        }
        showToast(`✅ Successfully extracted ${fileEntry.count} absolute limits from ${file.name}!`);
    } catch (err) {
        console.error("Error parsing PDF:", err);
        fileEntry.status = "failed";
        fileEntry.error = err.message;
        renderFilesListUI();
        showToast(`❌ Error parsing ${file.name}: ${err.message}`);
    }
}

function updateFileInfoUI() {
    document.getElementById("display-file-name").textContent = AppState.fileName;
    document.getElementById("display-file-meta").textContent = `${AppState.variables.length} Traces | ${AppState.numPoints.toLocaleString()} Points (${AppState.isBinary ? 'Binary' : 'ASCII'})`;
    document.getElementById("file-info").classList.remove("hidden");
    document.querySelector(".drop-content").classList.add("hidden");
    renderFilesListUI();
}

export function resetFileData() {
    resetFileDataState();

    document.getElementById("file-info").classList.add("hidden");
    document.querySelector(".drop-content").classList.remove("hidden");
    
    renderValidationTable();
    renderExplorerTable();
    renderFilesListUI();
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
        unit: "V",
        sourceFile: "Manual Entry",
        parseMethod: "JSON"
    };
    
    // Add "Manual Entry" to files if not exists
    let existing = AppState.loadedSpecFiles.find(f => f.name === "Manual Entry");
    if (!existing) {
        existing = {
            name: "Manual Entry",
            type: "JSON",
            count: 1,
            status: "success",
            error: null,
            parseMethod: "JSON"
        };
        AppState.loadedSpecFiles.push(existing);
    } else {
        existing.count++;
    }

    renderSpecEditor();
    renderFilesListUI();
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
            let importedSpecs = parsed.components ? parsed.components : parsed;
            
            // Clean up old specs from same file
            for (const compId of Object.keys(AppState.specs)) {
                if (AppState.specs[compId].sourceFile === file.name) {
                    delete AppState.specs[compId];
                }
            }

            // Tag with source file
            for (const spec of Object.values(importedSpecs)) {
                spec.sourceFile = file.name;
                spec.parseMethod = "JSON";
            }

            // Merge specs
            AppState.specs = Object.assign({}, AppState.specs, importedSpecs);

            // Add or update loaded spec files list
            let fileEntry = AppState.loadedSpecFiles.find(f => f.name === file.name);
            if (!fileEntry) {
                fileEntry = {
                    name: file.name,
                    type: "JSON",
                    count: Object.keys(importedSpecs).length,
                    status: "success",
                    error: null,
                    fileObject: file,
                    parseMethod: "JSON"
                };
                AppState.loadedSpecFiles.push(fileEntry);
            } else {
                fileEntry.status = "success";
                fileEntry.count = Object.keys(importedSpecs).length;
                fileEntry.parseMethod = "JSON";
            }

            renderSpecEditor();
            renderFilesListUI();
            if (AppState.numPoints > 0) runFullAnalysis();
            showToast(`📥 Successfully imported specifications from ${file.name}!`);
        } catch (err) {
            showToast("❌ Error importing JSON spec: " + err.message);
        }
    };
    reader.readAsText(file);
}

export function deleteSpecFile(fileName) {
    // Remove all specs associated with this source file
    for (const [compId, comp] of Object.entries(AppState.specs)) {
        if (comp.sourceFile === fileName) {
            delete AppState.specs[compId];
        }
    }
    // Remove from loaded spec files array
    AppState.loadedSpecFiles = AppState.loadedSpecFiles.filter(f => f.name !== fileName);
    
    renderSpecEditor();
    renderFilesListUI();
    if (AppState.numPoints > 0) runFullAnalysis();
    showToast(`Removed specs file: ${fileName}`);
}

export function clearSpecFileData(fileName) {
    // Delete all specs associated with this file
    for (const [compId, comp] of Object.entries(AppState.specs)) {
        if (comp.sourceFile === fileName) {
            delete AppState.specs[compId];
        }
    }
    // Set status to "cleared" and count to 0
    const fileObj = AppState.loadedSpecFiles.find(f => f.name === fileName);
    if (fileObj) {
        fileObj.count = 0;
        fileObj.status = "cleared";
        fileObj.error = null;
    }
    renderSpecEditor();
    renderFilesListUI();
    if (AppState.numPoints > 0) runFullAnalysis();
    showToast(`Cleared parsed ratings for ${fileName}`);
}

export function retryParse(fileName, method) {
    const file = window.loadedSpecFileObjects ? window.loadedSpecFileObjects[fileName] : null;
    if (file) {
        parsePDFDatasheet(file, method);
    } else {
        showToast("❌ File object reference lost. Please re-upload the PDF.");
    }
}

window.clearSpecFileData = clearSpecFileData;
window.retryParse = retryParse;

export function renderFilesListUI() {
    const simFileItem = document.getElementById("simulation-file-item");
    const specFilesList = document.getElementById("spec-files-list");
    const exportCsvBtn = document.getElementById("btn-export-csv");

    // 1. Render Simulation File card
    if (AppState.fileName) {
        simFileItem.className = "loaded-file-card";
        simFileItem.style.cssText = "background: var(--color-surface-2); border: 1px solid var(--color-border); padding: 12px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between; height: 60px; width: 100%;";
        simFileItem.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="color: var(--color-success); font-size: 1.2rem;">⚡</span>
                <div style="text-align: left;">
                    <div style="font-weight: 600; color: #fff; font-size: 0.9rem;">${AppState.fileName}</div>
                    <div style="font-size: 0.75rem; color: var(--color-ink-muted); font-family: var(--font-mono); margin-top: 1px;">
                        ${AppState.variables.length} Traces | ${AppState.numPoints.toLocaleString()} Points
                    </div>
                </div>
            </div>
            <button class="btn-icon-danger" onclick="resetFileData()" title="Remove file" style="padding: 6px;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        `;
    } else {
        simFileItem.className = "loaded-file-card empty-card";
        simFileItem.style.cssText = "background: var(--color-surface-2); border: 1px solid var(--color-border); padding: 12px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; height: 60px; width: 100%;";
        simFileItem.innerHTML = `<span class="no-file-text" style="color: var(--color-ink-muted); font-style: italic;">No simulation raw file loaded.</span>`;
    }

    // 2. Render Spec Sheets list
    specFilesList.innerHTML = "";
    if (AppState.loadedSpecFiles.length === 0) {
        specFilesList.innerHTML = `
            <div class="loaded-file-card empty-card" style="background: var(--color-surface-2); border: 1px solid var(--color-border); padding: 12px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; height: 60px;">
                <span class="no-file-text" style="color: var(--color-ink-muted); font-style: italic;">No specifications or datasheets loaded.</span>
            </div>
        `;
    } else {
        for (const file of AppState.loadedSpecFiles) {
            const card = document.createElement("div");
            card.className = "loaded-file-card";
            
            // Set dynamic card style based on state
            let borderStyle = "1px solid var(--color-border)";
            let bgStyle = "var(--color-surface-2)";
            let opacityStyle = "1";
            
            if (file.status === "parsing") {
                borderStyle = "1px solid var(--color-warning)";
                bgStyle = "rgba(245, 166, 35, 0.06)";
            } else if (file.status === "failed") {
                borderStyle = "1px solid var(--color-danger)";
                bgStyle = "rgba(239, 68, 68, 0.06)";
            } else if (file.status === "cleared") {
                opacityStyle = "0.65";
            }

            card.style.cssText = `background: ${bgStyle}; border: ${borderStyle}; opacity: ${opacityStyle}; padding: 12px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: space-between; min-height: 60px; width: 100%; box-sizing: border-box; margin-bottom: 4px;`;
            
            if (file.status === "parsing") {
                card.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="color: var(--color-warning); font-size: 1.25rem; display: inline-block; animation: spin-loader 1.5s linear infinite;">⏳</span>
                        <div style="text-align: left;">
                            <div style="font-weight: 600; color: #fff; font-size: 0.9rem;">${file.name}</div>
                            <div style="font-size: 0.75rem; color: var(--color-warning); margin-top: 1px;">
                                Parsing datasheet (${file.parseMethod} mode)...
                            </div>
                        </div>
                    </div>
                    <div></div>
                `;
            } else if (file.status === "failed") {
                card.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 10px; max-width: calc(100% - 190px);">
                        <span style="color: var(--color-danger); font-size: 1.25rem;">❌</span>
                        <div style="text-align: left; overflow: hidden;">
                            <div style="font-weight: 600; color: #fff; font-size: 0.9rem; text-decoration: line-through; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${file.name}</div>
                            <div style="font-size: 0.72rem; color: var(--color-danger); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; margin-top: 1px;" title="${file.error}">
                                Failed: ${file.error}
                            </div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
                        <button class="btn btn-secondary" onclick="retryParse('${file.name}', 'AI')" style="height: 22px; padding: 0 6px; font-size: 0.7rem; border-color: rgba(156, 85, 232, 0.45);">Retry AI</button>
                        <button class="btn btn-secondary" onclick="retryParse('${file.name}', 'Local')" style="height: 22px; padding: 0 6px; font-size: 0.7rem;">Retry Local</button>
                        <button class="btn-icon-danger" onclick="deleteSpecFile('${file.name}')" title="Remove file" style="padding: 6px;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                `;
            } else if (file.status === "cleared") {
                card.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="color: var(--color-ink-muted); font-size: 1.2rem;">🔘</span>
                        <div style="text-align: left;">
                            <div style="font-weight: 600; color: var(--color-ink-muted); font-size: 0.9rem;">${file.name}</div>
                            <div style="font-size: 0.75rem; color: var(--color-ink-muted); margin-top: 1px;">
                                Ratings cleared.
                            </div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
                        <button class="btn btn-secondary" onclick="retryParse('${file.name}', 'AI')" style="height: 22px; padding: 0 6px; font-size: 0.7rem;">Parse AI</button>
                        <button class="btn btn-secondary" onclick="retryParse('${file.name}', 'Local')" style="height: 22px; padding: 0 6px; font-size: 0.7rem;">Parse Local</button>
                        <button class="btn-icon-danger" onclick="deleteSpecFile('${file.name}')" title="Remove file" style="padding: 6px;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                `;
            } else { // success
                card.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="color: var(--color-secondary); font-size: 1.2rem;">${file.type === 'PDF' ? '📄' : '⚙️'}</span>
                        <div style="text-align: left;">
                            <div style="font-weight: 600; color: #fff; font-size: 0.9rem;">${file.name}</div>
                            <div style="font-size: 0.75rem; color: var(--color-ink-muted); margin-top: 1px;">
                                ${file.type} Specs • Extracted ${file.count} ratings (${file.parseMethod})
                            </div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
                        ${file.type === 'PDF' ? `
                            <button class="btn btn-secondary" onclick="retryParse('${file.name}', '${file.parseMethod === 'AI' ? 'Local' : 'AI'}')" style="height: 22px; padding: 0 6px; font-size: 0.7rem; border-color: rgba(156, 85, 232, 0.45);">
                                Use ${file.parseMethod === 'AI' ? 'Local' : 'AI'}
                            </button>
                        ` : ''}
                        <button class="btn btn-secondary" onclick="clearSpecFileData('${file.name}')" style="height: 22px; padding: 0 6px; font-size: 0.7rem;">Clear Data</button>
                        <button class="btn-icon-danger" onclick="deleteSpecFile('${file.name}')" title="Remove file" style="padding: 6px;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                `;
            }

            specFilesList.appendChild(card);
        }
    }

    // 3. Coordinate Export CSV Button state
    if (exportCsvBtn) {
        exportCsvBtn.disabled = (AppState.validationResults.length === 0);
    }
}

window.deleteSpecFile = deleteSpecFile;
window.renderFilesListUI = renderFilesListUI;

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
    const comp = AppState.specs[compId];
    if (comp && comp.sourceFile) {
        const fileObj = AppState.loadedSpecFiles.find(f => f.name === comp.sourceFile);
        if (fileObj && fileObj.count > 0) {
            fileObj.count--;
        }
    }
    delete AppState.specs[compId];
    renderSpecEditor();
    renderFilesListUI();
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

// --- Google AI Studio Model Retrieval ---
export async function fetchAndPopulateModels(apiKey) {
    const select = document.getElementById("select-model-name");
    if (!select) return;

    let models = [];
    const fallbackList = [
        { name: "gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash Lite" },
        { name: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
        { name: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash" },
        { name: "gemini-1.5-flash", displayName: "Gemini 1.5 Flash" },
        { name: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
        { name: "gemini-1.5-pro", displayName: "Gemini 1.5 Pro" }
    ];

    if (apiKey) {
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            if (res.ok) {
                const data = await res.json();
                if (data.models) {
                    models = data.models
                        .filter(m => m.supportedGenerationMethods.includes("generateContent"))
                        .map(m => {
                            const nameClean = m.name.replace(/^models\//, "");
                            return {
                                name: nameClean,
                                displayName: m.displayName
                            };
                        });
                }
            }
        } catch (e) {
            console.warn("Failed to fetch models from Google AI Studio, using defaults:", e);
        }
    }

    if (models.length === 0) {
        models = fallbackList;
    }

    // Populate select element
    select.innerHTML = "";
    const cleanCurrentModel = AppState.modelName.replace(/^models\//, "");
    
    // Add current model to options if it isn't listed
    const exists = models.some(m => m.name === cleanCurrentModel);
    if (!exists && cleanCurrentModel) {
        models.unshift({
            name: cleanCurrentModel,
            displayName: `Custom (${cleanCurrentModel})`
        });
    }

    for (const m of models) {
        const option = document.createElement("option");
        option.value = m.name;
        option.textContent = m.displayName;

        if (m.name === cleanCurrentModel) {
            option.selected = true;
        }
        select.appendChild(option);
    }
}
window.fetchAndPopulateModels = fetchAndPopulateModels;

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

    // AI Settings drawer bindings
    const settingsDrawer = document.getElementById("settings-drawer");
    const toggleSettingsBtn = document.getElementById("btn-toggle-settings");
    const saveSettingsBtn = document.getElementById("btn-save-settings");
    
    const apiKeyInput = document.getElementById("input-api-key");
    const modelSelect = document.getElementById("select-model-name");
    const useAiCheckbox = document.getElementById("checkbox-use-ai");

    // Populate initial settings fields
    apiKeyInput.value = AppState.apiKey;
    useAiCheckbox.checked = AppState.useAI;
    
    // Fetch and populate models dropdown list in the background
    fetchAndPopulateModels(AppState.apiKey);

    // Refresh model list in real time as the key is modified
    apiKeyInput.addEventListener("input", () => {
        fetchAndPopulateModels(apiKeyInput.value.trim());
    });

    toggleSettingsBtn.addEventListener("click", () => {
        settingsDrawer.classList.toggle("hidden");
    });

    const drawerBackdrop = settingsDrawer.querySelector(".drawer-backdrop");
    if (drawerBackdrop) {
        drawerBackdrop.addEventListener("click", () => {
            settingsDrawer.classList.add("hidden");
        });
    }

    saveSettingsBtn.addEventListener("click", () => {
        const key = apiKeyInput.value.trim();
        const model = modelSelect.value || "gemini-3.1-flash-lite";
        const useAi = useAiCheckbox.checked;

        AppState.apiKey = key;
        AppState.modelName = model;
        AppState.useAI = useAi;

        localStorage.setItem("ohmguard_api_key", key);
        localStorage.setItem("ohmguard_model_name", model);
        localStorage.setItem("ohmguard_use_ai", useAi ? "true" : "false");

        showToast("✅ Settings saved successfully!");
        settingsDrawer.classList.add("hidden");
    });

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
    renderFilesListUI();
}
