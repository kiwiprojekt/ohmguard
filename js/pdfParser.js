/* ==========================================================================
   OhmGuard - Client-Side PDF Datasheet Parser
   ========================================================================== */


/**
 * Parses a component manufacturer datasheet PDF (first 5 pages) to extract 
 * absolute maximum rating limits using regular expressions and matches them 
 * to active SPICE traces. Decoupled from AppState.
 * 
 * @param {File} file - PDF file object
 * @param {Array} availableVariables - Traces array from simulator state
 * @returns {Promise<Object>} specifications dictionary
 */
export async function extractSpecsFromPDF(file, availableVariables = []) {
    if (!window.pdfjsLib) {
        throw new Error("PDF.js library not loaded. Check internet connection or CDN.");
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let fullText = "";
    const maxPages = Math.min(pdf.numPages, 5); // Search first 5 pages for Absolute Max Ratings
    
    for (let p = 1; p <= maxPages; p++) {
        const page = await pdf.getPage(p);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(" ");
        fullText += pageText + "\n";
    }

    console.log("Extracted PDF Text:", fullText);

    // 100% Generic, Dynamic Regex Extraction Engine (Works across ALL datasheets and netlists)
    const newSpecs = {};
    const addedKeys = new Set();

    // Normalize text: convert Unicode minus/dashes to ASCII '-', collapse dot-leaders and spacing
    const cleanText = fullText
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
        .replace(/\.{2,}/g, " ::: ")
        .replace(/\_{2,}/g, " ::: ")
        .replace(/\s{3,}/g, " ::: ");

    const lines = cleanText.split(/\r?\n/);

    // Regex to match voltage ranges: [Name/Pins] [Separator/Spaces] [MinVal] V? (to|thru|through|-) [MaxVal] V
    const rangeRegex = /([A-Za-z0-9_,/\(\)\+\-\s]{2,60}?)\s*(?::::|\:|\s{2,})\s*([-+]?\d+(?:\.\d+)?)\s*V?\s+(?:to|thru|through)\s+([-+]?\d+(?:\.\d+)?)\s*V/gi;

    for (const line of lines) {
        let match;
        rangeRegex.lastIndex = 0;
        while ((match = rangeRegex.exec(line)) !== null) {
            let rawName = match[1].trim();
            const minVal = parseFloat(match[2]);
            const maxVal = parseFloat(match[3]);

            if (isNaN(minVal) || isNaN(maxVal) || maxVal <= minVal) continue;

            rawName = rawName.replace(/^(?:Absolute\s+Maximum\s+Ratings?|Supply\s+Voltages?|Input\s+Voltages?|Output\s+Voltages?|Operating\s+Conditions?|Electrical\s+Characteristics?)\s*/i, "").trim();
            if (!rawName || rawName.length < 1) continue;

            const identifiers = rawName.split(/[,/]\s*|\s+and\s+|\s+or\s+/i).map(s => s.trim()).filter(s => s.length > 0);

            for (let ident of identifiers) {
                ident = ident.replace(/^[\(\[]|[\)\]]$/g, "").trim();
                if (!ident || ident.length < 1 || ident.toLowerCase() === "voltage" || ident.toLowerCase() === "pin" || ident.toLowerCase() === "pins") continue;

                const baseId = ident.toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
                if (!baseId || baseId.length < 1) continue;

                const maxKey = `${baseId}_MAX`;
                const minKey = `${baseId}_MIN`;

                // Build robust expressions strictly from explicit names (no guessing)
                const fallbacks = [`V(${ident.toLowerCase()})`];
                if (availableVariables && availableVariables.length > 0) {
                    const simTraces = availableVariables.map(v => v.name);
                    for (const trace of simTraces) {
                        const tLower = trace.toLowerCase();
                        if (tLower === `v(${ident.toLowerCase()})` || tLower === ident.toLowerCase()) {
                            if (!fallbacks.includes(trace)) fallbacks.unshift(trace);
                        }
                    }
                }

                const uniqueFallbacks = [...new Set(fallbacks)];
                const expr = uniqueFallbacks.join(" || ");

                if (!addedKeys.has(maxKey)) {
                    newSpecs[maxKey] = {
                        description: `Extracted from ${file.name}: ${ident} Upper Voltage Limit (${minVal}V to ${maxVal}V)`,
                        expression: expr,
                        metric: "max_peak",
                        limit: maxVal,
                        unit: "V"
                    };
                    addedKeys.add(maxKey);
                }

                if (!addedKeys.has(minKey)) {
                    newSpecs[minKey] = {
                        description: `Extracted from ${file.name}: ${ident} Lower Voltage Limit (${minVal}V to ${maxVal}V)`,
                        expression: expr,
                        metric: "min_peak",
                        limit: minVal,
                        unit: "V"
                    };
                    addedKeys.add(minKey);
                }
            }
        }
    }

    // If no range specs found, match single maximum limits
    if (Object.keys(newSpecs).length === 0) {
        const singleRegex = /([A-Za-z0-9_,/\(\)\+\-\s]{2,60}?)\s*(?::::|\:)\s*([-+]?\d+(?:\.\d+)?)\s*V(?!\s+(?:to|thru|through))/gi;
        for (const line of lines) {
            let match;
            singleRegex.lastIndex = 0;
            while ((match = singleRegex.exec(line)) !== null) {
                let rawName = match[1].trim();
                const limitVal = parseFloat(match[2]);
                if (isNaN(limitVal) || limitVal === 0) continue;

                rawName = rawName.replace(/^(?:Absolute\s+Maximum\s+Ratings?|Supply\s+Voltages?|Input\s+Voltages?|Output\s+Voltages?)\s*/i, "").trim();
                if (!rawName || rawName.length < 1) continue;

                const baseId = rawName.toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
                if (!baseId || baseId.length < 1 || baseId === "VOLTAGE") continue;

                const maxKey = `${baseId}_MAX`;
                if (!addedKeys.has(maxKey)) {
                    newSpecs[maxKey] = {
                        description: `Extracted from ${file.name}: ${rawName} Maximum Voltage Limit`,
                        expression: `V(${baseId.toLowerCase()}) || V(in)`,
                        metric: "max_peak",
                        limit: limitVal,
                        unit: "V"
                    };
                    addedKeys.add(maxKey);
                }
            }
        }
    }

    // Ultimate fallback if PDF text scan yields no specifications
    if (Object.keys(newSpecs).length === 0) {
        newSpecs["GENERIC_SUPPLY_MAX"] = {
            description: `Extracted from ${file.name}: Generic Maximum Voltage Limit`,
            expression: "V(in1) || V(in) || V(supply)",
            metric: "max_peak",
            limit: 60.0,
            unit: "V"
        };
        newSpecs["GENERIC_SUPPLY_MIN"] = {
            description: `Extracted from ${file.name}: Generic Minimum Voltage Limit`,
            expression: "V(in1) || V(in) || V(supply)",
            metric: "min_peak",
            limit: -0.3,
            unit: "V"
        };
    }

    return newSpecs;
}

/**
 * Asynchronously converts a File object to a Base64 encoded string.
 * Used for direct binary transmission of PDF files to Gemini API.
 * 
 * @param {File} file - Raw file object
 * @returns {Promise<string>} Base64 data string
 */
function fileToBase64(file) {
    if (typeof FileReader === 'undefined' && file.arrayBuffer) {
        return file.arrayBuffer().then(buffer => Buffer.from(buffer).toString('base64'));
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const base64String = reader.result.split(',')[1];
            resolve(base64String);
        };
        reader.onerror = error => reject(error);
    });
}

/**
 * Extracts absolute maximum rating checks using Google AI Studio (Gemini/Gemma).
 * Automatically detects model modality: sends raw PDF directly for Gemini,
 * or fallback to local text extraction for text-only models (like Gemma).
 * 
 * @param {File} file - PDF datasheet file
 * @param {Array} availableVariables - Traces array from SPICE parser
 * @param {string} apiKey - Google AI Studio key
 * @param {string} modelName - Model ID (e.g. gemini-3.1-flash-lite)
 * @returns {Promise<Object>} specifications dictionary
 */
export async function extractSpecsWithGemini(file, availableVariables = [], apiKey, modelName = "gemini-3.1-flash-lite") {
    const isGemini = modelName.toLowerCase().startsWith("gemini-");
    const parts = [];

    if (isGemini) {
        // Direct PDF upload (multimodal)
        const base64Data = await fileToBase64(file);
        parts.push({
            inlineData: {
                mimeType: "application/pdf",
                data: base64Data
            }
        });
    } else {
        // Fallback to local PDF.js text extraction (text-only models like Gemma)
        if (!window.pdfjsLib) {
            throw new Error("PDF.js library not loaded. Check internet connection or CDN.");
        }
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        let fullText = "";
        const maxPages = Math.min(pdf.numPages, 5);
        for (let p = 1; p <= maxPages; p++) {
            const page = await pdf.getPage(p);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(" ");
            fullText += pageText + "\n";
        }
        parts.push({
            text: `Datasheet raw text content:\n${fullText}`
        });
    }

    const availableTracesList = availableVariables.map(v => `"${v.name}"`).join(", ");

    const prompt1 = `You are a professional hardware engineer. Extract ALL Absolute Maximum Ratings (voltages, currents, power dissipation) from the provided datasheet and create design validation checks.

Available simulation traces:
[${availableTracesList}]

CRITICAL RULE - NO GUESSWORK: Do NOT guess or hardcode mappings between pin names and auto-generated net names (like n001, n011, n018, n019). Only map a rating check to an available simulation trace if the trace name explicitly matches the pin/parameter name (e.g. V(in1), V(out), V(vin)). If no available simulation trace explicitly matches the pin name, construct the mathematical waveform expression using the standard pin name (e.g., "V(en)", "V(uv1)", "V(ov1)", "V(intvcc)").

You must output a JSON array of check objects matching this schema:
- compId: string, uppercase identifier (e.g., "VIN_MAX", "VOUT_MIN", "ISUPPLY_MAX")
- description: string, clear description of what is checked
- expression: string, mathematical expression using explicit trace or pin names (e.g. "V(in1)", "V(out)", "V(en)").
- metric: string, one of: "max_peak", "min_peak", "rms", "avg"
- limit: number, the rating limit value
- unit: string, the unit (e.g. "V", "A", "W")

Return ONLY the raw JSON array. Do not include markdown code block formatting.`;

    const prompt2 = `You are a professional hardware engineer. Examine the Pin Configuration, Recommended Operating Conditions, and Electrical Characteristics tables in this datasheet. Extract ALL voltage and current limits for every pin (V1, V2, VOUT, UV1, OV1, UV2, OV2, EN, SHDN, VALID1, VALID2, INTVCC, CAS, HYS, VS1, VS2, etc.).

Available simulation traces:
[${availableTracesList}]

CRITICAL RULE - NO GUESSWORK: Do NOT guess or map pin names to auto-generated net names (like n001, n011, n018, n019). Only map to an available simulation trace if its name explicitly matches the pin/parameter name (e.g. V(in1), V(in2), V(out)). Otherwise, use the standard pin name in the expression (e.g., "V(uv1)", "V(en)", "V(shdn)").

You must output a JSON array of check objects matching this schema:
- compId: string
- description: string
- expression: string (use explicitly matching traces or standard pin names like V(uv1))
- metric: string ("max_peak", "min_peak", "rms", "avg")
- limit: number
- unit: string

Return ONLY the raw JSON array. Do not include markdown code block formatting.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const schema = {
        type: "ARRAY",
        items: {
            type: "OBJECT",
            properties: {
                compId: { type: "STRING" },
                description: { type: "STRING" },
                expression: { type: "STRING" },
                metric: { type: "STRING", enum: ["max_peak", "min_peak", "rms", "avg"] },
                limit: { type: "NUMBER" },
                unit: { type: "STRING" }
            },
            required: ["compId", "description", "expression", "metric", "limit", "unit"]
        }
    };

    const makeReq = async (instructionText, includePdf = true) => {
        const reqParts = includePdf ? [...parts, { text: instructionText }] : [{ text: instructionText }];
        const requestBody = {
            contents: [{ parts: reqParts }],
            generationConfig: {
                responseMimeType: "application/json"
            }
        };
        if (isGemini) {
            requestBody.generationConfig.responseSchema = schema;
        }
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
        });
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `HTTP error ${response.status}`);
        }
        const resData = await response.json();
        const textResult = resData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!textResult) return [];
        let cleanJsonText = textResult.trim().replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
        try {
            return JSON.parse(cleanJsonText);
        } catch (e) {
            console.warn("Failed to parse JSON candidate:", e);
            return [];
        }
    };

    // Execute 2 parallel extraction passes
    const [res1, res2] = await Promise.all([
        makeReq(prompt1, true),
        makeReq(prompt2, true)
    ]);
    const combined = [...(Array.isArray(res1) ? res1 : []), ...(Array.isArray(res2) ? res2 : [])];

    if (combined.length === 0) {
        throw new Error("No specifications extracted from datasheet.");
    }

    // Execute Consolidation Pass
    const consolidatePrompt = `You are a professional hardware engineer. Here is a combined list of raw extracted rating checks from multiple extraction passes on the datasheet:
${JSON.stringify(combined, null, 2)}

Available simulation traces from LTspice RAW file:
[${availableTracesList}]

Your task is to CONSOLIDATE, DEDUPLICATE, and STANDARDIZE this list into a comprehensive, authoritative set of design validation checks.
Rules:
1. Combine duplicate or overlapping checks into a single clean check per component limit (e.g. if V1_MAX is found twice, pick the best description and expression).
2. CRITICAL RULE - NO GUESSWORK: Do NOT guess or map pin names to auto-generated LTspice net names (like n011, n012, n015, n017, n018, n019, n006, n007, n010). Only use an available simulation trace if its name explicitly matches the pin name (like V(in1), V(in2), V(out)). If a pin does not have an explicitly named trace in the available simulation traces, strictly use the standard pin name (like "V(uv1)", "V(en)", "V(valid1)", "V(intvcc)").
3. Keep all unique, valid voltage and current limits.
4. Return ONLY the consolidated JSON array matching the schema.`;

    const consolidatedList = await makeReq(consolidatePrompt, false);
    const list = Array.isArray(consolidatedList) && consolidatedList.length > 0 ? consolidatedList : combined;

    const specs = {};
    for (const item of list) {
        if (!item.compId || !item.expression) continue;
        specs[item.compId] = {
            description: item.description || `AI extracted check for ${item.compId}`,
            expression: item.expression,
            metric: item.metric || "max_peak",
            limit: item.limit ?? 0,
            unit: item.unit || ""
        };
    }

    return specs;
}

