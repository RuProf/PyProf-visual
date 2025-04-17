let selectedFile = null;
let selectedFunc = null;
let activeFile = "lprof_ext.json";
let history = [];
let historyIndex = -1;
let profilingData = null;
let pctThreshold = 15;
const defaultThreshold = 15;

const vscode = acquireVsCodeApi();

// Diagnostic: Log initialization
console.log('Webview script initialized');

// Request saved threshold on load
vscode.postMessage({ command: 'getThreshold' });

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    console.log('Received message from extension:', message); // Diagnostic
    try {
        if (message.command === 'loadData') {
            loadJSONData(message.data);
        } else if (message.command === 'setThreshold') {
            pctThreshold = message.value !== undefined ? message.value : defaultThreshold;
            thresholdInput.property("value", pctThreshold);
            if (profilingData) {
                console.log('Updating UI with new threshold:', pctThreshold); // Diagnostic
                updateUI(profilingData, selectedFile, selectedFunc);
            }
        } else if (message.command === 'loadFileTree') {
            loadFileTree(message.files);
        } else if (message.command === 'restoreState') {
            console.log('Restoring state:', message.state); // Diagnostic
            activeFile = message.state.activeFile || activeFile;
            selectedFile = message.state.selectedFile || selectedFile;
            selectedFunc = message.state.selectedFunc || selectedFunc;
            history = message.state.history || history;
            historyIndex = message.state.historyIndex || historyIndex;
            if (profilingData) {
                console.log('Restoring UI with profiling data'); // Diagnostic
                updateUI(profilingData, selectedFile, selectedFunc);
            } else {
                console.log('No profiling data to restore UI'); // Diagnostic
                showNoData();
            }
        }
    } catch (err) {
        console.error('Error handling message:', err); // Diagnostic
        vscode.postMessage({
            command: 'showError',
            message: `Error handling message: ${err.message}`
        });
    }
});

// Theme toggle logic
const themeToggleBtn = d3.select("#theme-toggle-btn");
const body = d3.select("body");

const savedTheme = localStorage.getItem("theme");
if (savedTheme === "dark") {
    body.classed("dark-theme", true);
    themeToggleBtn.text("☀️");
} else {
    themeToggleBtn.text("🌙");
}

themeToggleBtn.on("click", () => {
    const isDark = body.classed("dark-theme");
    body.classed("dark-theme", !isDark);
    themeToggleBtn.text(isDark ? "🌙" : "☀️");
    localStorage.setItem("theme", isDark ? "light" : "dark");
    console.log('Theme toggled to:', isDark ? 'light' : 'dark'); // Diagnostic
});

function loadFileTree(files) {
    console.log('Loading file tree with files:', files); // Diagnostic
    try {
        const fileTree = d3.select("#file-tree ul.directory");
        fileTree.selectAll("*").remove();

        const root = fileTree.append("li")
            .attr("class", "collapsible expanded")
            .text("Profiling Files")
            .on("click", function(event) {
                event.stopPropagation();
                d3.select(this).classed("expanded", !d3.select(this).classed("expanded"));
            });

        const fileList = fileTree.append("ul");
        const fileItems = fileList.selectAll("li")
            .data(files)
            .enter()
            .append("li")
            .attr("class", "function")
            .text(d => d)
            .classed("active", d => d === activeFile)
            .on("click", (event, d) => {
                event.stopPropagation();
                console.log('File clicked:', d); // Diagnostic
                d3.select("#main-content").style("display", "none");
                d3.select("#no-data").style("display", "none");
                d3.select("#loading").style("display", "block");
                selectedFile = null;
                selectedFunc = null;
                history = [];
                historyIndex = -1;
                profilingData = null;
                activeFile = d;
                fileList.selectAll("li").classed("active", f => f === activeFile);
                vscode.postMessage({ command: 'loadFile', file: d });
                saveState();
            });
    } catch (err) {
        console.error('Error in loadFileTree:', err); // Diagnostic
        vscode.postMessage({
            command: 'showError',
            message: `Error loading file tree: ${err.message}`
        });
    }
}

function saveState() {
    const state = { activeFile, selectedFile, selectedFunc, history, historyIndex };
    console.log('Saving state:', state); // Diagnostic
    vscode.postMessage({ command: 'saveState', state });
}

function updateUI(data, file = selectedFile, func = selectedFunc) {
    console.log('Updating UI with file:', file, 'func:', func); // Diagnostic
    try {
        const treeList = d3.select("#tree-list");
        const linesTable = d3.select("#lines-table tbody");
        const functionStats = d3.select("#function-stats");
        const functionNameHeader = d3.select("#function-name");
        const goBackBtn = d3.select("#go-back-btn");

        treeList.selectAll("*").remove();
        linesTable.selectAll("tr").remove();
        functionStats.text("");

        functionNameHeader.text(func ? `${file.replace('./', '')}::${func}()` : "No Function Selected");

        const treeUl = treeList.append("ul").attr("class", "directory");
        const root = treeUl.append("li").attr("class", "collapsible expanded").text("Files");
        root.on("click", function() {
            d3.select(this).classed("expanded", !d3.select(this).classed("expanded"));
        });
        const rootChildren = treeUl.append("ul");

        const files = Object.entries(data).filter(([folderName]) => folderName !== "entrypoint");
        files.sort(([aFolderName], [bFolderName]) => {
            const entrypoint = data.entrypoint;
            if (entrypoint) {
                if (aFolderName === entrypoint) return -1;
                if (bFolderName === entrypoint) return 1;
            }
            return aFolderName.localeCompare(bFolderName);
        });

        files.forEach(([folderName, folderData]) => {
            const folderLi = rootChildren.append("li")
                .attr("class", "collapsible expanded")
                .text(folderName);
            folderLi.on("click", function(event) {
                event.stopPropagation();
                d3.select(this).classed("expanded", !d3.select(this).classed("expanded"));
            });

            const funcUl = rootChildren.append("ul");
            const sortedFuncs = Object.entries(folderData).sort((a, b) => {
                const aLine = Math.min(...Object.keys(a[1].line).map(Number));
                const bLine = Math.min(...Object.keys(b[1].line).map(Number));
                return aLine - bLine;
            });
            sortedFuncs.forEach(([funcName, _]) => {
                const funcLi = funcUl.append("li")
                    .attr("class", "function")
                    .text(funcName)
                    .on("click", (event) => {
                        event.stopPropagation();
                        if (selectedFile && selectedFunc && (selectedFile !== folderName || selectedFunc !== funcName)) {
                            history = history.slice(0, historyIndex + 1);
                            history.push({ file: selectedFile, func: selectedFunc });
                            historyIndex++;
                        }
                        selectedFile = folderName;
                        selectedFunc = funcName;
                        console.log('Function clicked, updating UI:', selectedFile, selectedFunc); // Diagnostic
                        updateUI(profilingData, selectedFile, selectedFunc);
                        saveState();
                    });
                if (folderName === selectedFile && funcName === selectedFunc) {
                    funcLi.classed("active", true);
                }
            });
        });

        if (selectedFile && selectedFunc && data[selectedFile] && data[selectedFile][selectedFunc]) {
            const funcData = data[selectedFile][selectedFunc];
            const totalTimeSeconds = (funcData.total_time / 1e9).toFixed(6);
            functionStats.html(`Total Time: ${totalTimeSeconds} s`);

            const lines = Object.entries(funcData.line)
                .map(([lineNum, info]) => {
                    let time_per_hit = "";
                    if (info.time && info.count && info.count > 0) {
                        time_per_hit = (info.time / info.count / 1e9).toFixed(6) + " s";
                    }
                    return { line: lineNum, ...info, time_per_hit };
                })
                .sort((a, b) => +a.line - +b.line);

            const rows = linesTable.selectAll("tr")
                .data(lines)
                .enter()
                .append("tr");

            rows.append("td").text(d => d.line);
            rows.append("td").text(d => d.count || "");
            rows.append("td").text(d => d.time ? (d.time / 1e9).toFixed(6) + " s" : "");
            rows.append("td").text(d => d.time_per_hit);
            rows.append("td")
                .text(d => d.pct_time !== "" ? d.pct_time + "%" : "")
                .classed("highlight-red", d => d.pct_time && parseFloat(d.pct_time) > pctThreshold);
            rows.append("td")
                .attr("class", "code")
                .text(d => d.code || "-")
                .classed("clickable-code", function(d, i) {
                    if (i === 0) {
                        const callers = [];
                        const seenCallers = new Set();
                        for (const [fileName, fileData] of Object.entries(data)) {
                            if (fileName === "entrypoint") continue;
                            for (const [funcName, funcData] of Object.entries(fileData)) {
                                if (funcName === selectedFunc && fileName === selectedFile) continue;
                                for (const [lineNum, lineInfo] of Object.entries(funcData.line)) {
                                    if (lineInfo.code && typeof lineInfo.code === "string" && lineInfo.code.includes(selectedFunc)) {
                                        const callerKey = `${fileName}::${funcName}`;
                                        if (!seenCallers.has(callerKey)) {
                                            seenCallers.add(callerKey);
                                            callers.push({ file: fileName, func: funcName });
                                        }
                                    }
                                }
                            }
                        }
                        console.log(`Line ${d.line}: First row, callers found: ${callers.length}`); // Diagnostic
                        return callers.length > 0;
                    } else {
                        let targetFile = null;
                        let targetFunc = d.calls && d.calls !== "undefined" ? d.calls : null;
                        if (targetFunc) {
                            for (const [fileName, fileData] of Object.entries(data)) {
                                if (fileName === "entrypoint") continue;
                                if (targetFunc in fileData) {
                                    targetFile = fileName;
                                    console.log(`Line ${d.line}: Valid d.calls="${targetFunc}" in ${fileName}`); // Diagnostic
                                    return true;
                                }
                            }
                        }
                        if (d.code) {
                            const match = d.code.match(/(\w+)\(\)/);
                            if (match) {
                                targetFunc = match[1];
                                if (data[selectedFile] && data[selectedFile][targetFunc]) {
                                    targetFile = selectedFile;
                                    console.log(`Line ${d.line}: Valid function="${targetFunc}" in ${selectedFile} (from code)`); // Diagnostic
                                    return true;
                                }
                                for (const [fileName, fileData] of Object.entries(data)) {
                                    if (fileName === "entrypoint") continue;
                                    if (targetFunc in fileData) {
                                        targetFile = fileName;
                                        console.log(`Line ${d.line}: Valid function="${targetFunc}" in ${fileName} (from code)`); // Diagnostic
                                        return true;
                                    }
                                }
                            }
                        }
                        console.log(`Line ${d.line}: Not clickable, no valid function: code="${d.code}", calls="${d.calls}"`); // Diagnostic
                        return false;
                    }
                })
                .on("click", function(event, d) {
                    event.stopPropagation();
                    console.log(`Clicked line ${d.line}: code="${d.code}", calls="${d.calls}"`); // Diagnostic
                    const index = linesTable.selectAll("tr").nodes().indexOf(this.parentNode);

                    if (index === 0) {
                        const callersModal = d3.select("#callers-modal");
                        const callersTableBody = d3.select("#callers-table tbody");
                        callersTableBody.selectAll("*").remove();

                        const callers = [];
                        const seenCallers = new Set();
                        for (const [fileName, fileData] of Object.entries(data)) {
                            if (fileName === "entrypoint") continue;
                            for (const [funcName, funcData] of Object.entries(fileData)) {
                                if (funcName === selectedFunc && fileName === selectedFile) continue;
                                for (const [lineNum, lineInfo] of Object.entries(funcData.line)) {
                                    if (lineInfo.code && typeof lineInfo.code === "string" && lineInfo.code.includes(selectedFunc)) {
                                        const callerKey = `${fileName}::${funcName}`;
                                        if (!seenCallers.has(callerKey)) {
                                            seenCallers.add(callerKey);
                                            callers.push({
                                                file: fileName,
                                                func: funcName,
                                                hits: lineInfo.count || 0
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        console.log(`Callers for ${selectedFile}::${selectedFunc}:`, callers); // Diagnostic

                        if (callers.length === 1) {
                            history = history.slice(0, historyIndex + 1);
                            history.push({ file: selectedFile, func: selectedFunc });
                            historyIndex++;
                            selectedFile = callers[0].file;
                            selectedFunc = callers[0].func;
                            updateUI(profilingData, selectedFile, selectedFunc);
                            saveState();
                            console.log(`Navigating to single caller: ${selectedFile}::${selectedFunc}`); // Diagnostic
                        } else if (callers.length > 1) {
                            const rows = callersTableBody.selectAll("tr")
                                .data(callers)
                                .enter()
                                .append("tr")
                                .attr("class", "caller-row")
                                .on("click", function(event, d) {
                                    event.stopPropagation();
                                    history = history.slice(0, historyIndex + 1);
                                    history.push({ file: selectedFile, func: selectedFunc });
                                    historyIndex++;
                                    selectedFile = d.file;
                                    selectedFunc = d.func;
                                    updateUI(profilingData, selectedFile, selectedFunc);
                                    callersModal.style("display", "none");
                                    saveState();
                                    console.log(`Navigating from modal to: ${d.file}::${d.func}`); // Diagnostic
                                });

                            rows.append("td").text(d => d.hits);
                            rows.append("td").text(d => `${d.func}()`);
                            rows.append("td").text(d => d.file.replace('./', ''));

                            callersModal.style("display", "block");
                        }
                    } else {
                        let targetFile = null;
                        let targetFunc = d.calls && d.calls !== "undefined" ? d.calls : null;
                        
                        if (targetFunc) {
                            for (const [fileName, fileData] of Object.entries(profilingData)) {
                                if (fileName === "entrypoint") continue;
                                if (targetFunc in fileData) {
                                    targetFile = fileName;
                                }
                            }
                        }

                        if (!targetFile && d.code) {
                            const match = d.code.match(/(\w+)\(\)/);
                            if (match) {
                                targetFunc = match[1];
                                if (data[selectedFile] && data[selectedFile][targetFunc]) {
                                    targetFile = selectedFile;
                                } else {
                                    for (const [fileName, fileData] of Object.entries(profilingData)) {
                                        if (fileName === "entrypoint") continue;
                                        if (targetFunc in fileData) {
                                            targetFile = fileName;
                                            break;
                                        }
                                    }
                                }
                            }
                        }

                        if (targetFile && targetFunc) {
                            history = history.slice(0, historyIndex + 1);
                            history.push({ file: selectedFile, func: selectedFunc });
                            historyIndex++;
                            selectedFile = targetFile;
                            selectedFunc = targetFunc;
                            updateUI(profilingData, selectedFile, selectedFunc);
                            saveState();
                            console.log(`Navigating to ${targetFile}::${targetFunc}`); // Diagnostic
                        } else {
                            console.log(`No valid target for line ${d.line}: calls="${d.calls}", code="${d.code}"`); // Diagnostic
                        }
                    }
                });
        }

        goBackBtn.on("click", () => {
            if (historyIndex > 0) {
                historyIndex--;
                const prev = history[historyIndex];
                selectedFile = prev.file;
                selectedFunc = prev.func;
                console.log('Going back to:', selectedFile, selectedFunc); // Diagnostic
                updateUI(profilingData, selectedFile, selectedFunc);
                saveState();
            }
        });

        goBackBtn.style("display", historyIndex > 0 ? "flex" : "none");
        showMainContent();
        saveState();
    } catch (err) {
        console.error('Error in updateUI:', err); // Diagnostic
        vscode.postMessage({
            command: 'showError',
            message: `Error updating UI: ${err.message}`
        });
    }
}

function showMainContent() {
    console.log('Showing main content'); // Diagnostic
    d3.select("#main-content").style("display", "block");
    d3.select("#no-data").style("display", "none");
    d3.select("#loading").style("display", "none");
}

function showNoData() {
    console.log('Showing no-data placeholder'); // Diagnostic
    d3.select("#main-content").style("display", "none");
    d3.select("#no-data").style("display", "block");
    d3.select("#loading").style("display", "none");
}

function loadJSONData(data) {
    console.log('Loading JSON data:', JSON.stringify(data, null, 2)); // Diagnostic
    try {
        d3.select("#loading").style("display", "block");
        profilingData = data;

        if (data.entrypoint && typeof data.entrypoint === "string" && data[data.entrypoint]) {
            selectedFile = data.entrypoint;
            const functions = Object.keys(data[selectedFile]);
            // selectedFunc = functions.includes("main") ? "main" : functions[0] || null;
            selectedFunc = functions.includes("main") ? "main" : functions[0] || null;
            history = [{ file: selectedFile, func: selectedFunc }];
            historyIndex = 0;
        } else {
            const files = Object.keys(data).filter(key => key !== "entrypoint");
            selectedFile = files[0] || null;
            if (selectedFile) {
                const functions = Object.keys(data[selectedFile]);
                // selectedFunc = functions.includes("main") ? "main" : functions[0] || null;
                selectedFunc = functions.includes("main") ? "main" : functions[0] || null;
                history = [{ file: selectedFile, func: selectedFunc }];
                historyIndex = 0;
            }
        }

        if (selectedFile && selectedFunc) {
            console.log('Initial UI update with:', selectedFile, selectedFunc); // Diagnostic
            showMainContent();
            updateUI(profilingData, selectedFile, selectedFunc);
        } else {
            console.log('No valid file or function, showing no-data'); // Diagnostic
            showNoData();
        }
        saveState();
    } catch (err) {
        console.error('Error loading JSON data:', err); // Diagnostic
        vscode.postMessage({
            command: 'showError',
            message: `Failed to load profiling data: ${err.message}`
        });
        showNoData();
    }
}

// Tree toggle button
d3.select("#tree-toggle-btn").on("click", () => {
    const isExpanded = d3.selectAll("#tree-list .collapsible").classed("expanded");
    if (isExpanded) {
        d3.selectAll("#tree-list .collapsible").classed("expanded", false);
        d3.select("#tree-toggle-btn").text("+ Expand +");
    } else {
        d3.selectAll("#tree-list .collapsible").classed("expanded", true);
        d3.select("#tree-toggle-btn").text("- Collapse -");
    }
    console.log('Tree toggled, expanded:', !isExpanded); // Diagnostic
});

// Settings modal logic
const settingsModal = d3.select("#settings-modal");
const settingsBtn = d3.select("#settings-btn");
const closeSettingsBtn = d3.select("#settings-modal .close");
const saveSettingsBtn = d3.select("#save-settings");
const resetSettingsBtn = d3.select("#reset-settings");
const thresholdInput = d3.select("#pct-threshold");

settingsBtn.on("click", () => {
    settingsModal.style("display", "block");
    thresholdInput.property("value", pctThreshold);
    console.log('Settings modal opened'); // Diagnostic
});

closeSettingsBtn.on("click", () => {
    settingsModal.style("display", "none");
    console.log('Settings modal closed'); // Diagnostic
});

saveSettingsBtn.on("click", () => {
    const newThreshold = parseFloat(thresholdInput.property("value"));
    if (!isNaN(newThreshold) && newThreshold >= 0 && newThreshold <= 100) {
        pctThreshold = newThreshold;
        vscode.postMessage({
            command: 'saveThreshold',
            value: newThreshold
        });
        settingsModal.style("display", "none");
        if (profilingData) {
            updateUI(profilingData, selectedFile, selectedFunc);
        }
        console.log('Saved threshold:', newThreshold); // Diagnostic
    } else {
        vscode.postMessage({
            command: 'showError',
            message: "Please enter a valid percentage between 0 and 100."
        });
        console.log('Invalid threshold input'); // Diagnostic
    }
});

resetSettingsBtn.on("click", () => {
    pctThreshold = defaultThreshold;
    thresholdInput.property("value", defaultThreshold);
    vscode.postMessage({
        command: 'saveThreshold',
        value: defaultThreshold
    });
    settingsModal.style("display", "none");
    if (profilingData) {
        updateUI(profilingData, selectedFile, selectedFunc);
    }
    console.log('Reset threshold to:', defaultThreshold); // Diagnostic
});

// Callers modal logic
const callersModal = d3.select("#callers-modal");
const closeCallersBtn = d3.select("#callers-modal .close");

closeCallersBtn.on("click", () => {
    callersModal.style("display", "none");
    console.log('Callers modal closed'); // Diagnostic
});

// Close modals when clicking outside
window.addEventListener("click", (event) => {
    if (event.target === settingsModal.node()) {
        settingsModal.style("display", "none");
        console.log('Settings modal closed (outside click)'); // Diagnostic
    }
    if (event.target === callersModal.node()) {
        callersModal.style("display", "none");
        console.log('Callers modal closed (outside click)'); // Diagnostic
    }
});