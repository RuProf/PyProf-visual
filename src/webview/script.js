let selectedFile = null;
let selectedFunc = null;
let activeFile = "lprof_ext.json"; // Track active file
let history = [];
let historyIndex = -1;
let profilingData = null;
let pctThreshold = 15;
const defaultThreshold = 15;

const vscode = acquireVsCodeApi();

// Request saved threshold on load
vscode.postMessage({ command: 'getThreshold' });

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    if (message.command === 'loadData') {
        loadJSONData(message.data);
    } else if (message.command === 'setThreshold') {
        pctThreshold = message.value !== undefined ? message.value : defaultThreshold;
        thresholdInput.property("value", pctThreshold);
        if (profilingData) {
            updateUI(profilingData, selectedFile, selectedFunc);
        }
    } else if (message.command === 'loadFileTree') {
        loadFileTree(message.files);
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
});

function loadFileTree(files) {
    const fileTree = d3.select("#file-tree ul.directory");
    fileTree.selectAll("*").remove();

    // Add "Profiling Files" collapsible node
    const root = fileTree.append("li")
        .attr("class", "collapsible expanded")
        .text("Profiling Files")
        .on("click", function(event) {
            event.stopPropagation();
            d3.select(this).classed("expanded", !d3.select(this).classed("expanded"));
        });

    // Add files as children
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
            // Clear previous data
            d3.select("#main-content").style("display", "none");
            selectedFile = null;
            selectedFunc = null;
            history = [];
            historyIndex = -1;
            profilingData = null;
            // Update active file
            activeFile = d;
            // Update highlight
            fileList.selectAll("li").classed("active", f => f === activeFile);
            // Request file load
            vscode.postMessage({ command: 'loadFile', file: d });
        });
}

function updateUI(data, file = selectedFile, func = selectedFunc) {
    const treeList = d3.select("#tree-list");
    const linesTable = d3.select("#lines-table tbody");
    const functionStats = d3.select("#function-stats");
    const functionNameHeader = d3.select("#function-name");
    const goBackBtn = d3.select("#go-back-btn");

    treeList.selectAll("*").remove();
    linesTable.selectAll("tr").remove();
    functionStats.text("");

    functionNameHeader.text(func ? `${file.replace('./', '')}::${func}()` : "No Function Selected");

    // Build file/function tree
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
                    updateUI(profilingData, selectedFile, selectedFunc);
                });
            if (folderName === selectedFile && funcName === selectedFunc) {
                funcLi.classed("active", true);
            }
        });
    });

    // Populate function details and lines table
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
                    console.log(`Line ${d.line}: First row, callers found: ${callers.length}`);
                    return callers.length > 0;
                } else {
                    let targetFile = null;
                    let targetFunc = d.calls && d.calls !== "undefined" ? d.calls : null;
                    if (targetFunc) {
                        for (const [fileName, fileData] of Object.entries(data)) {
                            if (fileName === "entrypoint") continue;
                            if (targetFunc in fileData) {
                                targetFile = fileName;
                                console.log(`Line ${d.line}: Valid d.calls="${targetFunc}" in ${fileName}`);
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
                                console.log(`Line ${d.line}: Valid function="${targetFunc}" in ${selectedFile} (from code)`);
                                return true;
                            }
                            for (const [fileName, fileData] of Object.entries(data)) {
                                if (fileName === "entrypoint") continue;
                                if (targetFunc in fileData) {
                                    targetFile = fileName;
                                    console.log(`Line ${d.line}: Valid function="${targetFunc}" in ${fileName} (from code)`);
                                    return true;
                                }
                            }
                        }
                    }
                    console.log(`Line ${d.line}: Not clickable, no valid function: code="${d.code}", calls="${d.calls}"`);
                    return false;
                }
            })
            .on("click", function(event, d) {
                event.stopPropagation();
                console.log(`Clicked line ${d.line}: code="${d.code}", calls="${d.calls}"`);
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
                    console.log(`Callers for ${selectedFile}::${selectedFunc}:`, callers);

                    if (callers.length === 1) {
                        history = history.slice(0, historyIndex + 1);
                        history.push({ file: selectedFile, func: selectedFunc });
                        historyIndex++;
                        selectedFile = callers[0].file;
                        selectedFunc = callers[0].func;
                        updateUI(profilingData, selectedFile, selectedFunc);
                        console.log(`Navigating to single caller: ${selectedFile}::${selectedFunc}`);
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
                                console.log(`Navigating from modal to: ${d.file}::${d.func}`);
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
                        console.log(`Navigating to ${targetFile}::${targetFunc}`);
                    } else {
                        console.log(`No valid target for line ${d.line}: calls="${d.calls}", code="${d.code}"`);
                    }
                }
            });
    }

    // Handle back navigation
    goBackBtn.on("click", () => {
        if (historyIndex > 0) {
            historyIndex--;
            const prev = history[historyIndex];
            selectedFile = prev.file;
            selectedFunc = prev.func;
            updateUI(profilingData, selectedFile, selectedFunc);
        }
    });

    // Show/hide "Go Back" button
    goBackBtn.style("display", historyIndex > 0 ? "flex" : "none");
}

function showMainContent() {
    d3.select("#main-content").style("display", "block");
}

function loadJSONData(data) {
    try {
        console.log("Loading JSON data:", JSON.stringify(data, null, 2));
        profilingData = data;

        if (data.entrypoint && typeof data.entrypoint === "string" && data[data.entrypoint]) {
            selectedFile = data.entrypoint;
            const functions = Object.keys(data[selectedFile]);
            selectedFunc = functions.includes("main") ? "main" : functions[0] || null;
            history = [{ file: selectedFile, func: selectedFunc }];
            historyIndex = 0;
        } else {
            const files = Object.keys(data).filter(key => key !== "entrypoint");
            selectedFile = files[0] || null;
            if (selectedFile) {
                const functions = Object.keys(data[selectedFile]);
                selectedFunc = functions.includes("main") ? "main" : functions[0] || null;
                history = [{ file: selectedFile, func: selectedFunc }];
                historyIndex = 0;
            }
        }

        showMainContent();
        updateUI(profilingData, selectedFile, selectedFunc);
    } catch (err) {
        console.error("Error loading JSON data:", err);
        vscode.postMessage({
            command: 'showError',
            message: "Failed to load profiling data. Please ensure the JSON is valid."
        });
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
});

closeSettingsBtn.on("click", () => {
    settingsModal.style("display", "none");
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
    } else {
        vscode.postMessage({
            command: 'showError',
            message: "Please enter a valid percentage between 0 and 100."
        });
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
});

// Callers modal logic
const callersModal = d3.select("#callers-modal");
const closeCallersBtn = d3.select("#callers-modal .close");

closeCallersBtn.on("click", () => {
    callersModal.style("display", "none");
});

// Close modals when clicking outside
window.addEventListener("click", (event) => {
    if (event.target === settingsModal.node()) {
        settingsModal.style("display", "none");
    }
    if (event.target === callersModal.node()) {
        callersModal.style("display", "none");
    }
});