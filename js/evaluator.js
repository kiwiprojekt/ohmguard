/* ==========================================================================
   OhmGuard - Mathematical Waveform Evaluator & Stress Integrator
   ========================================================================== */

/**
 * Evaluates mathematical SPICE expressions into a Float32Array vector.
 * Supports standard algebraic operators, functions, and differential voltages V(a,b).
 * 
 * @param {string} expr - Formula to evaluate, e.g. "V(out)", "V(in1, in2)", "I(C1) * V(out)"
 * @param {Object} traceData - Map of traceName -> Float32Array
 * @param {number} nPoints - Total simulation data points
 * @returns {Float32Array|null} Vector result, or null on error
 */
/**
 * Helper to escape special regular expression characters.
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolves a fallback trace expression (containing '||') to the first matching trace in traceData.
 * If no matching trace is found, returns the first trace in the fallback list.
 * 
 * @param {string} expr - Expression string (e.g. "V(in1) || V(in) || V(supply)")
 * @param {Object} traceData - Map of traceName -> Float32Array
 * @returns {string} The resolved trace expression
 */
export function resolveFallbackExpression(expr, traceData) {
    if (!expr || !traceData) return expr;
    if (expr.includes("||")) {
        const parts = expr.split("||").map(s => s.trim());
        for (const part of parts) {
            if (traceData[part]) return part;
            const found = Object.keys(traceData).find(k => k.toLowerCase() === part.toLowerCase());
            if (found) return found;
        }
        return parts[0];
    }
    return expr;
}

/**
 * Evaluates mathematical SPICE expressions into a Float32Array vector.
 * Supports standard algebraic operators, functions, and differential voltages V(a,b).
 * 
 * @param {string} expr - Formula to evaluate, e.g. "V(out)", "V(in1, in2)", "I(C1) * V(out)"
 * @param {Object} traceData - Map of traceName -> Float32Array
 * @param {number} nPoints - Total simulation data points
 * @returns {Float32Array|null} Vector result, or null on error
 */
export function evaluateWaveformExpression(expr, traceData, nPoints) {
    if (!expr || !traceData || nPoints === 0) return null;

    // Check if expression is simply a direct trace name (fast path)
    if (traceData[expr]) {
        return traceData[expr];
    }

    // Case-insensitive direct trace check
    const exactKey = Object.keys(traceData).find(k => k.toLowerCase() === expr.toLowerCase());
    if (exactKey) {
        return traceData[exactKey];
    }

    // Otherwise, build a JIT-compiled vectorized expression evaluation loop
    try {
        let jsExpr = expr.replace(/\^/g, '**');
        
        // Replace math functions with Math.func
        jsExpr = jsExpr.replace(/\b(abs|sqrt|sin|cos|exp|log|max|min)\b/g, 'Math.$1');
        
        // Pre-convert differential node voltage expressions:
        // V(nodeA, nodeB) should be replaced with (V(nodeA) - V(nodeB))
        // Likewise for I(nodeA, nodeB) or other differential parameters.
        jsExpr = jsExpr.replace(/([VvIi])\(([^,()]+)\s*,\s*([^,()]+)\)/g, '($1($2) - $1($3))');

        // Resolve bare identifiers to V(node) or I(device) if they match existing traces
        const sortedTraceKeys = Object.keys(traceData).sort((a, b) => b.length - a.length);
        const words = [];
        const regexWords = /(?<![VvIi]\()\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
        let match;
        while ((match = regexWords.exec(jsExpr)) !== null) {
            words.push(match[1]);
        }
        
        const mathReserved = new Set(["abs", "sqrt", "sin", "cos", "exp", "log", "max", "min", "Math", "i"]);
        for (const word of words) {
            if (mathReserved.has(word)) continue;
            
            // If the word itself exists directly in traceData, leave it for regular replacement
            const exactKey = sortedTraceKeys.find(k => k.toLowerCase() === word.toLowerCase());
            if (exactKey) continue;

            // Otherwise, check if V(word) or I(word) exists in trace keys
            const vKey = `v(${word})`;
            const iKey = `i(${word})`;
            
            const matchingVKey = sortedTraceKeys.find(k => k.toLowerCase() === vKey.toLowerCase());
            if (matchingVKey) {
                const regex = new RegExp('\\b' + escapeRegExp(word) + '\\b', 'g');
                jsExpr = jsExpr.replace(regex, matchingVKey);
                continue;
            }

            const matchingIKey = sortedTraceKeys.find(k => k.toLowerCase() === iKey.toLowerCase());
            if (matchingIKey) {
                const regex = new RegExp('\\b' + escapeRegExp(word) + '\\b', 'g');
                jsExpr = jsExpr.replace(regex, matchingIKey);
                continue;
            }
        }

        // Replace SPICE trace identifiers with data["traceName"][i] references
        for (const key of sortedTraceKeys) {
            const escaped = escapeRegExp(key);
            let pattern = escaped;
            if (/^\w/.test(key)) pattern = '\\b' + pattern;
            if (/\w$/.test(key)) pattern = pattern + '\\b';
            const regex = new RegExp(pattern, 'gi');
            jsExpr = jsExpr.replace(regex, `data["${key}"][i]`);
        }

        // Security check: validate that the compiled code contains only safe math operations
        const safeExprCheck = jsExpr.replace(/data\["[^"]+"\]\[i\]/g, '')
                                    .replace(/Math\.[a-z]+/g, '')
                                    .replace(/\d+(\.\d+)?/g, '')
                                    .replace(/i/g, '')
                                    .trim();
        const allowedOperators = /^[+\-*/%()?,:\s><=!&|]*$/;
        if (!allowedOperators.test(safeExprCheck)) {
            return null; // Unmapped bare identifiers or unsupported syntax
        }

        const result = new Float32Array(nPoints);
        // Compile vectorized evaluation loop
        const evaluator = new Function('data', 'result', 'nPoints', 'Math', `
            for (let i = 0; i < nPoints; i++) {
                result[i] = ${jsExpr};
            }
        `);
        evaluator(traceData, result, nPoints, Math);
        return result;
    } catch (err) {
        return null;
    }
}

/**
 * Computes min, max, RMS, and average metrics for a trace.
 * Performs trapezoidal time-weighted integration when a time vector is supplied.
 * 
 * @param {Float32Array} waveform - Waveform data points
 * @param {Float64Array|Float32Array|null} timeVector - Matching time vector points
 * @returns {Object|null} Statistical metrics
 */
export function calculateWaveformMetrics(waveform, timeVector) {
    if (!waveform || waveform.length === 0) return null;

    let minVal = Infinity;
    let maxVal = -Infinity;
    let absMax = 0;
    let sum = 0;
    let sumSq = 0;
    const n = waveform.length;

    for (let i = 0; i < n; i++) {
        const val = waveform[i];
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
        const absVal = Math.abs(val);
        if (absVal > absMax) absMax = absVal;
        sum += val;
        sumSq += val * val;
    }

    const pkPk = maxVal - minVal;

    // Default calculations if no timeVector is available (uniform steps)
    let avgVal = sum / n;
    let rmsVal = Math.sqrt(sumSq / n);

    // Trapezoidal time-weighted integration
    if (timeVector && timeVector.length === n && n > 1) {
        let trapSum = 0;
        let trapSqSum = 0;
        const totalTime = timeVector[n - 1] - timeVector[0];
        
        if (totalTime > 0) {
            for (let i = 0; i < n - 1; i++) {
                const dt = timeVector[i + 1] - timeVector[i];
                trapSum += 0.5 * (waveform[i] + waveform[i + 1]) * dt;
                trapSqSum += 0.5 * (waveform[i] * waveform[i] + waveform[i + 1] * waveform[i + 1]) * dt;
            }
            avgVal = trapSum / totalTime;
            rmsVal = Math.sqrt(trapSqSum / totalTime);
        }
    }

    return {
        min: minVal,
        max: maxVal,
        pkpk: pkPk,
        abs_peak: absMax,
        rms: rmsVal,
        avg: avgVal
    };
}
