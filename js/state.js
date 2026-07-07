/* ==========================================================================
   OhmGuard - Global Application State
   ========================================================================== */

export const AppState = {
    rawFile: null,
    fileName: "",
    variables: [],        // Array of { index, name, type }
    data: {},             // Map of traceName -> Float32Array
    timeVector: null,     // Float64Array or Float32Array of time steps
    numPoints: 0,
    isBinary: true,
    
    // Component Specifications & Derating Limits
    specs: {},
    
    // Calculated Results
    validationResults: [],
    explorerResults: [],
    currentSort: { column: "name", ascending: true }
};

/**
 * Resets the transient file-related state data.
 */
export function resetFileDataState() {
    AppState.rawFile = null;
    AppState.fileName = "";
    AppState.variables = [];
    AppState.data = {};
    AppState.timeVector = null;
    AppState.numPoints = 0;
    AppState.validationResults = [];
    AppState.explorerResults = [];
}
