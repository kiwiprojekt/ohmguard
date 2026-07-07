import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseLTspiceRaw } from '../js/spiceParser.js';
import { evaluateWaveformExpression, calculateWaveformMetrics, resolveFallbackExpression } from '../js/evaluator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}

function runParserTests() {
    console.log("=== Running Parser Tests ===");
    
    const rawFilePath = path.join(__dirname, 'LTC4418.raw');
    const buffer = fs.readFileSync(rawFilePath);
    
    // Convert Buffer to ArrayBuffer
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    
    const parsed = parseLTspiceRaw(arrayBuffer);
    
    console.log(`Parsed RAW file successfully.`);
    console.log(`Number of points: ${parsed.numPoints}`);
    console.log(`Number of traces: ${parsed.variables.length}`);
    
    assert(parsed.numPoints > 0, "Points count should be greater than 0");
    assert(parsed.variables.length > 0, "Traces count should be greater than 0");
    assert(parsed.data !== null, "Trace data map should be populated");
    assert(parsed.timeVector !== null, "Time vector should be populated");
    
    // Verify some specific traces exist
    const traceNames = parsed.variables.map(v => v.name);
    assert(traceNames.includes('time'), "Should contain 'time' trace");
    
    console.log("✅ Parser Tests Passed!\n");
}

function runEvaluatorTests() {
    console.log("=== Running Evaluator Tests ===");
    
    const mockTraceData = {
        'V(in1)': new Float32Array([10.0, 12.0, 8.0]),
        'V(in2)': new Float32Array([2.0, 2.0, 2.0]),
        'V(out)': new Float32Array([-5.0, 0.0, 5.0]),
        'time': new Float64Array([0.0, 1.0, 2.0]),
        'time_step': new Float32Array([0.1, 0.2, 0.3])
    };
    const nPoints = 3;

    // Test 1: Direct trace key lookup
    const resDirect = evaluateWaveformExpression("V(out)", mockTraceData, nPoints);
    assert(resDirect !== null, "Direct trace lookup should succeed");
    assert(resDirect[0] === -5.0 && resDirect[1] === 0.0 && resDirect[2] === 5.0, "Direct trace values match");

    // Test 2: Case insensitivity
    const resCase = evaluateWaveformExpression("v(OUT)", mockTraceData, nPoints);
    assert(resCase !== null, "Case-insensitive lookup should succeed");
    assert(resCase[0] === -5.0, "Case-insensitive values match");

    // Test 3: Math function abs
    const resAbs = evaluateWaveformExpression("abs(V(out))", mockTraceData, nPoints);
    assert(resAbs !== null, "abs(V(out)) should succeed");
    assert(resAbs[0] === 5.0 && resAbs[1] === 0.0 && resAbs[2] === 5.0, "abs values match");

    // Test 4: Differential voltage V(a,b)
    const resDiff = evaluateWaveformExpression("V(in1, in2)", mockTraceData, nPoints);
    assert(resDiff !== null, "V(in1, in2) should succeed");
    assert(resDiff[0] === 8.0 && resDiff[1] === 10.0 && resDiff[2] === 6.0, "Differential values match");

    // Test 5: Nested functions and differential voltage
    const resNested = evaluateWaveformExpression("abs(V(in1, in2))", mockTraceData, nPoints);
    assert(resNested !== null, "abs(V(in1, in2)) should succeed");
    assert(resNested[0] === 8.0, "Nested values match");

    // Test 6: Multi-argument function max
    const resMax = evaluateWaveformExpression("max(V(out), 2)", mockTraceData, nPoints);
    assert(resMax !== null, "max(V(out), 2) should succeed");
    assert(resMax[0] === 2.0 && resMax[1] === 2.0 && resMax[2] === 5.0, "max values match");

    // Test 7: Trace name substring matching (time vs time_step)
    const resTime = evaluateWaveformExpression("time + time_step", mockTraceData, nPoints);
    assert(resTime !== null, "time + time_step should succeed");
    assert(Math.abs(resTime[0] - 0.1) < 1e-5, "Substring trace name match succeeds");

    // Test 8: Fallback expression resolution
    const resolved = resolveFallbackExpression("V(nonexistent) || V(in1) || V(supply)", mockTraceData);
    assert(resolved === "V(in1)", "Fallback should resolve to V(in1)");

    console.log("✅ Evaluator Tests Passed!\n");
}

function runMetricsTests() {
    console.log("=== Running Metrics Tests ===");
    
    const waveform = new Float32Array([2.0, 4.0, 6.0]);
    const timeVector = new Float64Array([0.0, 1.0, 2.0]);
    
    const metrics = calculateWaveformMetrics(waveform, timeVector);
    assert(metrics !== null, "Metrics calculation should succeed");
    assert(metrics.min === 2.0, "Min matches");
    assert(metrics.max === 6.0, "Max matches");
    assert(metrics.pkpk === 4.0, "Peak-to-peak matches");
    assert(metrics.abs_peak === 6.0, "Absolute peak matches");
    
    // Average: trapezoidal integration
    // Integral = 0.5 * (2 + 4) * 1 + 0.5 * (4 + 6) * 1 = 3 + 5 = 8
    // Average = 8 / 2 = 4
    assert(Math.abs(metrics.avg - 4.0) < 1e-5, "Average (trapezoidal) matches");
    
    // RMS: trapezoidal integration of square
    // Waveform squared: [4, 16, 36]
    // Integral Sq = 0.5 * (4 + 16) * 1 + 0.5 * (16 + 36) * 1 = 10 + 26 = 36
    // Mean Sq = 36 / 2 = 18
    // RMS = sqrt(18) = 4.24264
    assert(Math.abs(metrics.rms - Math.sqrt(18)) < 1e-5, "RMS (trapezoidal) matches");
    
    console.log("✅ Metrics Tests Passed!\n");
}

try {
    runParserTests();
    runEvaluatorTests();
    runMetricsTests();
    console.log("🎉 All tests passed successfully!");
} catch (error) {
    console.error("❌ Test run failed:", error.message);
    console.error(error.stack);
    process.exit(1);
}
