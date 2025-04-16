import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function activate(context: vscode.ExtensionContext) {
    const defaultThreshold = 15; // Match script.js

    let disposable = vscode.commands.registerCommand('PyProfVisual.open', async () => {
        console.log('Opening PyProf-visual');
        const panel = vscode.window.createWebviewPanel(
            'PyProfVisual',
            'PyProf-visual',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(context.extensionPath, 'src', 'webview')),
                    vscode.Uri.file(path.join(context.extensionPath, 'node_modules'))
                ]
            }
        );

        const htmlPath = path.join(context.extensionPath, 'src', 'webview', 'index.html');
        const cssPath = vscode.Uri.file(path.join(context.extensionPath, 'src', 'webview', 'styles.css'));
        const scriptPath = vscode.Uri.file(path.join(context.extensionPath, 'src', 'webview', 'script.js'));
        const d3Path = vscode.Uri.file(path.join(context.extensionPath, 'node_modules', 'd3', 'dist', 'd3.min.js'));

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
        console.log('Initial VS Code theme:', isDark ? 'dark' : 'light');
        panel.webview.postMessage({ command: 'setTheme', isDark });

        // Listen for theme changes
        const themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme((theme) => {
            const newIsDark = theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;
            console.log('VS Code theme changed to:', newIsDark ? 'dark' : 'light');
            panel.webview.postMessage({ command: 'setTheme', isDark: newIsDark });
        });
        context.subscriptions.push(themeChangeDisposable);

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            const lprofileDir = path.join(workspaceFolders[0].uri.fsPath, '.lprofile');
            const jsonPath = path.join(lprofileDir, 'lprof_ext.json');

            // Check and create .lprofile/ if it doesn't exist
            console.log(`Checking for .lprofile/ at: ${lprofileDir}`);
            if (!fs.existsSync(lprofileDir)) {
                try {
                    fs.mkdirSync(lprofileDir);
                    console.log(`Created .lprofile/ directory at: ${lprofileDir}`);
                } catch (err) {
                    console.error('Error creating .lprofile/ directory:', err);
                    vscode.window.showErrorMessage('Failed to create .lprofile/ directory.');
                }
            }

            // Load file tree
            let files = [];
            if (fs.existsSync(lprofileDir)) {
                try {
                    files = fs.readdirSync(lprofileDir).filter(file => file.endsWith('.json'));
                    console.log(`Found files in .lprofile/: ${files.join(', ')}`);
                    panel.webview.postMessage({ command: 'loadFileTree', files });
                } catch (err) {
                    console.error('Error reading .lprofile/ directory:', err);
                    vscode.window.showErrorMessage('Failed to read .lprofile/ directory.');
                }
            } else {
                console.log('No .lprofile/ directory, empty file tree');
                panel.webview.postMessage({ command: 'loadFileTree', files: [] });
            }

            // Load lprof_ext.json if it exists
            console.log(`Checking for lprof_ext.json at: ${jsonPath}`);
            if (fs.existsSync(jsonPath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                    console.log('Loaded .lprofile/lprof_ext.json from workspace, sending to Webview');
                    panel.webview.postMessage({ command: 'loadData', data });
                } catch (err) {
                    console.error('Error loading .lprofile/lprof_ext.json:', err);
                    const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
                    vscode.window.showErrorMessage(`Failed to load .lprofile/lprof_ext.json: ${errorMessage}`);
                }
            } else {
                console.log('No .lprofile/lprof_ext.json in workspace, displaying empty webview');
            }
        } else {
            console.log('No workspace open, displaying empty webview and empty file tree');
            panel.webview.postMessage({ command: 'loadFileTree', files: [] });
        }

        panel.webview.onDidReceiveMessage(
            message => {
                console.log('Received message from Webview:', message);
                if (message.command === 'saveThreshold') {
                    context.globalState.update('pctThreshold', message.value);
                    console.log(`Saved threshold: ${message.value}`);
                } else if (message.command === 'getThreshold') {
                    const threshold = context.globalState.get('pctThreshold', defaultThreshold);
                    panel.webview.postMessage({
                        command: 'setThreshold',
                        value: threshold
                    });
                    console.log(`Sent threshold: ${threshold}`);
                } else if (message.command === 'showError') {
                    vscode.window.showErrorMessage(message.message);
                    console.log(`Displayed error: ${message.message}`);
                } else if (message.command === 'loadFile') {
                    if (workspaceFolders) {
                        const filePath = path.join(workspaceFolders[0].uri.fsPath, '.lprofile', message.file);
                        console.log(`Loading file: ${filePath}`);
                        try {
                            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                            panel.webview.postMessage({ command: 'loadData', data });
						} catch (err: unknown) {
                            console.error(`Error loading file ${message.file}:`, err);
                            vscode.window.showErrorMessage(`Failed to load ${message.file}: ${(err instanceof Error ? err.message : 'Unknown error')}`);
                        }
                    }
                }
            },
            undefined,
            context.subscriptions
        );
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}