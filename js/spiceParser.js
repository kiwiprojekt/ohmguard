/* ==========================================================================
   OhmGuard - LTspice .RAW Waveform File Parser
   ========================================================================== */

/**
 * Parses both Binary and ASCII LTspice .raw simulation files.
 * Returns an object containing the parsed traces, metadata, and time vector.
 * Decoupled from AppState for testability.
 * 
 * @param {ArrayBuffer} buffer - Raw file buffer
 * @returns {Object} { variables, numPoints, data, isBinary, timeVector }
 */
export function parseLTspiceRaw(buffer) {
    const uint8View = new Uint8Array(buffer);
    let headerText = "";
    let headerEndIndex = 0;
    let isBinary = false;

    // Detect UTF-16LE vs ASCII/UTF-8 encoding (LTspice on Windows defaults to UTF-16LE)
    const isUTF16LE = (uint8View[0] === 0xFF && uint8View[1] === 0xFE) || (uint8View[1] === 0x00 && uint8View[3] === 0x00);
    const startOffset = (uint8View[0] === 0xFF && uint8View[1] === 0xFE) ? 2 : 0;
    const step = isUTF16LE ? 2 : 1;

    // Search for "Binary:" or "Values:" tag
    const maxHeaderCheck = Math.min(buffer.byteLength, 100000);
    for (let i = startOffset; i < maxHeaderCheck; i += step) {
        const charCode = isUTF16LE ? (uint8View[i] | (uint8View[i + 1] << 8)) : uint8View[i];
        const char = String.fromCharCode(charCode);
        headerText += char;
        
        if (headerText.endsWith("Binary:\n") || headerText.endsWith("Binary:\r\n")) {
            isBinary = true;
            headerEndIndex = i + step;
            break;
        } else if (headerText.endsWith("Values:\n") || headerText.endsWith("Values:\r\n")) {
            isBinary = false;
            headerEndIndex = i + step;
            break;
        }
    }

    if (headerEndIndex === 0) {
        throw new Error("Invalid LTspice .raw file format (could not find Binary: or Values: tag).");
    }

    // Parse Header Metadata
    const lines = headerText.split(/\r?\n/);
    let numVars = 0;
    let numPoints = 0;
    let flags = "";
    const variables = [];
    let readingVars = false;

    for (const line of lines) {
        if (line.startsWith("No. Variables:")) {
            numVars = parseInt(line.split(":")[1].trim(), 10);
        } else if (line.startsWith("No. Points:")) {
            numPoints = parseInt(line.split(":")[1].trim(), 10);
        } else if (line.startsWith("Flags:")) {
            flags = line.split(":")[1].trim();
        } else if (line.startsWith("Variables:")) {
            readingVars = true;
            continue;
        } else if (line.startsWith("Binary:") || line.startsWith("Values:")) {
            readingVars = false;
            break;
        } else if (readingVars) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 3) {
                variables.push({
                    index: parseInt(parts[0], 10),
                    name: parts[1],
                    type: parts[2]
                });
            }
        }
    }

    // Pre-allocate typed arrays for trace data
    const data = {};
    for (const v of variables) {
        data[v.name] = new Float32Array(numPoints);
    }

    // Parse Data Section
    if (isBinary) {
        const dataView = new DataView(buffer, headerEndIndex);
        const bytesRemaining = buffer.byteLength - headerEndIndex;
        
        // Detect precision: standard LTspice is 8-byte double for Time (var 0), 4-byte float for others
        // If fastaccess / double flag is set, all variables are 8-byte doubles.
        const allDouble = (bytesRemaining === numPoints * numVars * 8) || flags.toLowerCase().includes("double");
        
        let byteOffset = 0;
        for (let p = 0; p < numPoints; p++) {
            for (let v = 0; v < numVars; v++) {
                const varName = variables[v].name;
                let val = 0;
                
                if (allDouble || v === 0) {
                    val = dataView.getFloat64(byteOffset, true); // Little-endian
                    byteOffset += 8;
                } else {
                    val = dataView.getFloat32(byteOffset, true);
                    byteOffset += 4;
                }
                
                data[varName][p] = val;
            }
        }
    } else {
        // ASCII file parsing
        const asciiText = new TextDecoder(isUTF16LE ? "utf-16le" : "utf-8").decode(uint8View.subarray(headerEndIndex));
        const tokens = asciiText.trim().split(/\s+/);
        let tokenIdx = 0;
        
        for (let p = 0; p < numPoints; p++) {
            // In ASCII, each point starts with the point index number
            tokenIdx++; 
            for (let v = 0; v < numVars; v++) {
                const varName = variables[v].name;
                data[varName][p] = parseFloat(tokens[tokenIdx++]);
            }
        }
    }

    // Identify Time or Frequency vector for RMS & Average integration
    const timeVar = variables.find(v => v.name.toLowerCase() === 'time' || v.name.toLowerCase() === 'frequency');
    let timeVector = null;
    if (timeVar) {
        const rawTime = data[timeVar.name];
        timeVector = new Float64Array(rawTime.length);
        for (let i = 0; i < rawTime.length; i++) {
            timeVector[i] = Math.abs(rawTime[i]);
        }
        // Save the cleaned vector back to data map
        data[timeVar.name] = timeVector;
    }

    return {
        variables,
        numPoints,
        data,
        isBinary,
        timeVector
    };
}
