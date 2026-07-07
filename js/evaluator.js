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
export function evaluateWaveformExpression(expr, traceData, nPoints) {
    if (!expr || !traceData || nPoints === 0) return null;

    // Support fallback trace checking with || syntax (e.g. "V(uv2) || V(in2)")
    if (expr.includes("||")) {
        const parts = expr.split("||").map(s => s.trim());
        for (const part of parts) {
            if (traceData[part]) return traceData[part];
            const found = Object.keys(traceData).find(k => k.toLowerCase() === part.toLowerCase());
            if (found) return traceData[found];
        }
    }

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
        
        // [BUGFIX]: Pre-convert differential node voltage expressions:
        // V(nodeA, nodeB) should be replaced with (V(nodeA) - V(nodeB))
        // Likewise for I(nodeA, nodeB) or other differential parameters.
        jsExpr = jsExpr.replace(/([VvIi])\(([^,]+)\s*,\s*([^)]+)\)/g, '($1($2) - $1($3))');

        // Replace SPICE trace identifiers like V(out), I(C1), Id(M1), V(n1,n2) with data["V(out)"][i]
        const pattern = /[a-zA-Z]\w*\([^)]+\)/g;
        jsExpr = jsExpr.replace(pattern, (match) => {
            const foundKey = Object.keys(traceData).find(k => k.toLowerCase() === match.toLowerCase());
            if (!foundKey) {
                throw new Error(`Trace "${match}" not found in waveform data!`);
            }
            return `data["${foundKey}"][i]`;
        });

        // Security check: validate that the compiled code contains only safe math operations
        const safeExprCheck = jsExpr.replace(/data\["[^"]+"\]\[i\]/g, '')
                                    .replace(/Math\.[a-z]+/g, '')
                                    .replace(/\d+(\.\d+)?/g, '')
                                    .replace(/i/g, '')
                                    .trim();
        const allowedOperators = /^[+\-*/%()?:\s><=!&|]*$/;
        if (!allowedOperators.test(safeExprCheck)) {
            throw new Error(`Forbidden operations found in math expression: "${safeExprCheck}"`);
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
        console.warn(`Could not evaluate expression: "${expr}" ->`, err.message);
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
