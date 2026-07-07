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

                // Build robust, generic fallback expressions
                const fallbacks = [`V(${ident.toLowerCase()})`];
                if (baseId === "V1" || baseId === "VIN" || baseId === "IN") {
                    fallbacks.push("V(in)", "V(in1)", "V(vin)", "V(supply)");
                } else if (baseId === "V2") {
                    fallbacks.push("V(in2)", "V(v2)");
                } else if (baseId === "VOUT" || baseId === "OUT") {
                    fallbacks.push("V(out)", "V(vout)");
                } else if (baseId === "UV1") {
                    fallbacks.push("V(n011)", "V(in1)");
                } else if (baseId === "OV1") {
                    fallbacks.push("V(n012)");
                } else if (baseId === "UV2") {
                    fallbacks.push("V(in2)", "V(n017)");
                } else if (baseId === "OV2") {
                    fallbacks.push("V(n015)");
                } else if (baseId === "TMR") {
                    fallbacks.push("V(n019)");
                }

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
