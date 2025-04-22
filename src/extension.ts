import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Define interface for saved state
interface WebviewState {
    activeFile?: string;
    selectedFunc?: string; // Last selected function in the function tree
    pctThreshold?: number; // Threshold for this webview
    [key: string]: any; // Allow other properties
}

export async function activate(context: vscode.ExtensionContext) {
    const defaultThreshold = 15;
    let currentPanel: vscode.WebviewPanel | null = null; // Track the single webview panel

    let disposable = vscode.commands.registerCommand('PyProfVisual.open', async () => {
        console.log('Attempting to open PyProf'); // Diagnostic

        // Check if a webview is already open
        if (currentPanel) {
            vscode.window.showInformationMessage('try: docker run --rm -d -p 8080:8080 ruprof/prof_gui:rust');
            vscode.window.showErrorMessage('One viewer at a time. Use Docker for multi-profiles. Checkout https://github.com/RuProf/prof_gui');
            return;
        }

        // Create the webview panel
        const panel = vscode.window.createWebviewPanel(
            'PyProfVisual',
            'PyProf',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true, // Persist webview state across reloads
                localResourceRoots: [
                    vscode.Uri.file(path.join(context.extensionPath, 'src', 'webview')),
                    vscode.Uri.file(path.join(context.extensionPath, 'node_modules'))
                ]
            }
        );

        // Set the current panel
        currentPanel = panel;

        const htmlPath = path.join(context.extensionPath, 'src', 'webview', 'index.html');
        const cssPath = vscode.Uri.file(path.join(context.extensionPath, 'src', 'webview', 'styles.css'));
        const scriptPath = vscode.Uri.file(path.join(context.extensionPath, 'src', 'webview', 'script.js'));
        const d3Path = vscode.Uri.file(path.join(context.extensionPath, 'node_modules', 'd3', 'dist', 'd3.min.js'));

        // Diagnostic: Verify resource paths
        console.log('HTML path:', htmlPath, 'Exists:', fs.existsSync(htmlPath));
        console.log('CSS path:', cssPath.fsPath, 'Exists:', fs.existsSync(cssPath.fsPath));
        console.log('Script path:', scriptPath.fsPath, 'Exists:', fs.existsSync(scriptPath.fsPath));
        console.log('D3 path:', d3Path.fsPath, 'Exists:', fs.existsSync(d3Path.fsPath));

        let htmlContent = fs.readFileSync(htmlPath, 'utf8');
        htmlContent = htmlContent
            .replace('{{cssPath}}', panel.webview.asWebviewUri(cssPath).toString())
            .replace('{{scriptPath}}', panel.webview.asWebviewUri(scriptPath).toString())
            .replace('{{d3Path}}', panel.webview.asWebviewUri(d3Path).toString());

        panel.webview.html = htmlContent;

        // Set initial theme
        const themeKind = vscode.window.activeColorTheme.kind;
        const isDark = themeKind === vscode.ColorThemeKind.Dark || themeKind === vscode.ColorThemeKind.HighContrast;
        console.log('Initial VS Code theme:', isDark ? 'dark' : 'light'); // Diagnostic
        panel.webview.postMessage({ command: 'setTheme', isDark });

        // Listen for theme changes
        const themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme((theme) => {
            const newIsDark = theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;
            console.log('VS Code theme changed to:', newIsDark ? 'dark' : 'light'); // Diagnostic
            panel.webview.postMessage({ command: 'setTheme', isDark: newIsDark });
        });
        context.subscriptions.push(themeChangeDisposable);

        // Function to restore state and load data
        const restoreWebviewStateAndData = (forceReload: boolean = false) => {
            console.log('Restoring webview state and data, forceReload:', forceReload); // Diagnostic
            const savedState = context.globalState.get<WebviewState>('webviewState');
            if (savedState) {
                console.log('Restoring saved state:', savedState); // Diagnostic
                // Send the full state to restore activeFile, selectedFunc, and pctThreshold
                panel.webview.postMessage({ command: 'restoreState', state: savedState });

                // Reload the active file’s data only if forceReload is true or no data has been loaded
                if ((forceReload || !savedState.activeFile) && savedState.activeFile) {
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (workspaceFolders) {
                        const lprofileDir = path.join(workspaceFolders[0].uri.fsPath, '.lprofile');
                        const filePath = path.join(lprofileDir, savedState.activeFile);
                        if (fs.existsSync(filePath)) {
                            try {
                                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                                console.log(`Reloaded ${savedState.activeFile} from saved state:`, JSON.stringify(data, null, 2)); // Diagnostic
                                panel.webview.postMessage({ command: 'loadData', data });
                            } catch (err) {
                                console.error(`Error reloading ${savedState.activeFile}:`, err); // Diagnostic
                                const errorMessage = err instanceof Error ? err.message : String(err);
                                vscode.window.showErrorMessage(`Failed to reload ${savedState.activeFile}: ${errorMessage}`);
                            }
                        }
                    }
                }
                // Restore threshold if set
                if (savedState.pctThreshold !== undefined) {
                    panel.webview.postMessage({
                        command: 'setThreshold',
                        value: savedState.pctThreshold
                    });
                    console.log(`Restored threshold: ${savedState.pctThreshold}`); // Diagnostic
                }
            }

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders) {
                const lprofileDir = path.join(workspaceFolders[0].uri.fsPath, '.lprofile');
                console.log(`Checking for .lprofile/ at: ${lprofileDir}`); // Diagnostic

                // Create .lprofile/ directory if it doesn't exist
                if (!fs.existsSync(lprofileDir)) {
                    try {
                        fs.mkdirSync(lprofileDir);
                        console.log(`Created .lprofile/ directory at: ${lprofileDir}`); // Diagnostic
                    } catch (err) {
                        console.error('Error creating .lprofile/ directory:', err); // Diagnostic
                        const errorMessage = err instanceof Error ? err.message : String(err);
                        vscode.window.showErrorMessage(`Failed to create .lprofile/ directory: ${errorMessage}`);
                    }
                }

                // Get list of JSON files in .lprofile/
                let files: string[] = [];
                if (fs.existsSync(lprofileDir)) {
                    try {
                        files = fs.readdirSync(lprofileDir).filter(file => file.endsWith('.json'));
                        console.log(`Found files in .lprofile/: ${files.join(', ')}`); // Diagnostic
                        panel.webview.postMessage({ command: 'loadFileTree', files });
                    } catch (err) {
                        console.error('Error reading .lprofile/ directory:', err); // Diagnostic
                        const errorMessage = err instanceof Error ? err.message : String(err);
                        vscode.window.showErrorMessage(`Failed to read .lprofile/ directory: ${errorMessage}`);
                    }
                } else {
                    console.log('No .lprofile/ directory, empty file tree'); // Diagnostic
                    panel.webview.postMessage({ command: 'loadFileTree', files: [] });
                }

                // Load JSON file based on the specified cases (only if no activeFile was loaded from state)
                if (!savedState?.activeFile && fs.existsSync(lprofileDir) && files.length > 0) {
                    const jsonPath = path.join(lprofileDir, 'lprof_ext.json');
                    let targetFile: string | null = null;

                    // Case 1: Check if lprof_ext.json exists
                    if (fs.existsSync(jsonPath)) {
                        targetFile = 'lprof_ext.json';
                        console.log(`Found lprof_ext.json at: ${jsonPath}`); // Diagnostic
                    } else {
                        // Case 2: Load any JSON file if lprof_ext.json doesn't exist
                        targetFile = files[0];
                        console.log(`lprof_ext.json not found, selecting first JSON file: ${targetFile}`); // Diagnostic
                    }
                    
                    // print targetFile
                    
                    // Load the selected JSON file
                    if (targetFile) {
                        const filePath = path.join(lprofileDir, targetFile);
                        try {
                            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                            console.log(`Loaded ${targetFile}:`, JSON.stringify(data, null, 2)); // Diagnostic
                            panel.webview.postMessage({ command: 'loadData', data });
                            // Update activeFile to reflect the loaded file
                            panel.webview.postMessage({ command: 'restoreState', state: { activeFile: targetFile } });
                            context.globalState.update('webviewState', { activeFile: targetFile, pctThreshold: savedState?.pctThreshold ?? defaultThreshold });
                        } catch (err) {
                            console.error(`Error loading ${targetFile}:`, err); // Diagnostic
                            const errorMessage = err instanceof Error ? err.message : String(err);
                            vscode.window.showErrorMessage(`Failed to load ${targetFile}: ${errorMessage}`);
                        }
                    }
                } else if (!savedState?.activeFile) {
                    // Case 3: No JSON files found
                    vscode.window.showErrorMessage('No JSON files in .lprofile/, displaying empty webview');
                    console.log('No JSON files in .lprofile/, displaying empty webview'); // Diagnostic
                    panel.webview.postMessage({ command: 'loadFileTree', files: [] });
                    // Set default threshold if no state exists
                    panel.webview.postMessage({
                        command: 'setThreshold',
                        value: defaultThreshold
                    });
                }
            } else {
                console.log('No workspace open, displaying empty webview and empty file tree'); // Diagnostic
                panel.webview.postMessage({ command: 'loadFileTree', files: [] });
                // Set default threshold
                panel.webview.postMessage({
                    command: 'setThreshold',
                    value: defaultThreshold
                });
            }
        };

        // Run the restore logic once at the beginning with full reload
        restoreWebviewStateAndData(true);

        // Handle webview visibility changes
        panel.onDidChangeViewState(() => {
            if (panel.visible) {
                console.log('Webview became visible, restoring state'); // Diagnostic
                restoreWebviewStateAndData(false); // Avoid reloading data unnecessarily
            } else {
                console.log('Webview became hidden'); // Diagnostic
            }
        }, undefined, context.subscriptions);

        panel.webview.onDidReceiveMessage(
            message => {
                console.log('Received message from Webview:', message); // Diagnostic
                try {
                    if (message.command === 'saveThreshold') {
                        // Save threshold in webview state
                        const currentState = context.globalState.get<WebviewState>('webviewState') || {};
                        context.globalState.update('webviewState', {
                            ...currentState,
                            pctThreshold: message.value
                        });
                        console.log(`Saved threshold: ${message.value}`); // Diagnostic
                    } else if (message.command === 'getThreshold') {
                        const savedState = context.globalState.get<WebviewState>('webviewState');
                        const threshold = savedState?.pctThreshold ?? defaultThreshold;
                        panel.webview.postMessage({
                            command: 'setThreshold',
                            value: threshold
                        });
                        console.log(`Sent threshold: ${threshold}`); // Diagnostic
                    } else if (message.command === 'showError') {
                        vscode.window.showErrorMessage(message.message);
                        console.log(`Displayed error: ${message.message}`); // Diagnostic
                    } else if (message.command === 'loadFile') {
                        const workspaceFolders = vscode.workspace.workspaceFolders;
                        if (workspaceFolders) {
                            const filePath = path.join(workspaceFolders[0].uri.fsPath, '.lprofile', message.file);
                            console.log(`Loading file: ${filePath}`); // Diagnostic
                            try {
                                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                                panel.webview.postMessage({ command: 'loadData', data });
                                // Update activeFile in state
                                const currentState = context.globalState.get<WebviewState>('webviewState') || {};
                                panel.webview.postMessage({ command: 'restoreState', state: { activeFile: message.file } });
                                context.globalState.update('webviewState', {
                                    ...currentState,
                                    activeFile: message.file
                                });
                            } catch (err) {
                                console.error(`Error loading file ${message.file}:`, err); // Diagnostic
                                const errorMessage = err instanceof Error ? err.message : String(err);
                                vscode.window.showErrorMessage(`Failed to load ${message.file}: ${errorMessage}`);
                            }
                        } else {
                            console.error('No workspace open, cannot load file:', message.file); // Diagnostic
                            vscode.window.showErrorMessage('No workspace open. Please open a workspace to load profiling data.');
                        }
                    } else if (message.command === 'saveState') {
                        // Save the entire state, including activeFile, selectedFunc, and pctThreshold
                        context.globalState.update('webviewState', message.state);
                        console.log('Saved webview state:', message.state); // Diagnostic
                    }
                } catch (err) {
                    console.error('Error handling webview message:', err); // Diagnostic
                    const errorMessage = err instanceof Error ? err.message : String(err);
                    vscode.window.showErrorMessage(`Error handling message: ${errorMessage}`);
                }
            },
            undefined,
            context.subscriptions
        );

        // Handle panel disposal
        panel.onDidDispose(() => {
            currentPanel = null;
            context.globalState.update('PyProfVisualPanel', undefined);
            console.log('Webview panel disposed'); // Diagnostic
        }, undefined, context.subscriptions);

        // Save panel state for reload
        context.globalState.update('PyProfVisualPanel', true);
    });

    // Recreate panel if it was open before reload
    if (context.globalState.get('PyProfVisualPanel')) {
        console.log('Recreating PyProf webview after window reload'); // Diagnostic
        await vscode.commands.executeCommand('PyProfVisual.open');
    }

    context.subscriptions.push(disposable);
}

export function deactivate(context: vscode.ExtensionContext) {
    // Clear panel state on deactivation
    context.globalState.update('webviewState', undefined);
    context.globalState.update('PyProfVisualPanel', undefined);
}