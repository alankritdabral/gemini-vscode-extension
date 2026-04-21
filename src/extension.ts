import * as vscode from 'vscode';
import { GeminiProcess } from './geminiProcess';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export function activate(context: vscode.ExtensionContext) {
    try {
        console.log('Gemini CLI Extension Host started');
        const outputChannel = vscode.window.createOutputChannel('Gemini CLI');
        context.subscriptions.push(outputChannel);

        const provider = new GeminiChatViewProvider(context.extensionUri, outputChannel, context);

        const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        statusItem.text = '$(sparkle) Gemini: Idle';
        statusItem.command = 'gemini-cli-ui.openChat';
        statusItem.show();
        context.subscriptions.push(statusItem);

        provider.onStateChange((state) => {
            if (state === 'running') {
                statusItem.text = '$(sync~spin) Gemini: Thinking...';
                statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            } else {
                statusItem.text = '$(sparkle) Gemini: Idle';
                statusItem.backgroundColor = undefined;
            }
        });

        const sessionsProvider = new GeminiSessionsProvider(outputChannel);
        vscode.window.registerTreeDataProvider('gemini-cli-ui.sessionsView', sessionsProvider);

        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(GeminiChatViewProvider.viewType, provider)
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('gemini-cli-ui.openChat', () => {
                vscode.commands.executeCommand('workbench.view.extension.gemini-chat-explorer');
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('gemini-cli-ui.resumeSession', async () => {
                const sessions = await provider.getSessions();
                if (sessions.length === 0) {
                    vscode.window.showInformationMessage('No recent sessions found.');
                    return;
                }

                const items = sessions.map(s => ({
                    label: s.summary,
                    description: s.age,
                    detail: s.id,
                    index: s.index
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a session to resume'
                });

                if (selected) {
                    provider.resumeSession(selected.detail);
                }
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('gemini-cli-ui.resumeSessionFromTree', (sessionId: string) => {
                provider.resumeSession(sessionId);
            }),
            vscode.commands.registerCommand('gemini-cli-ui.refreshSessions', () => {
                sessionsProvider.refresh();
            })
        );
    } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to activate Gemini CLI UI: ${e.message}`);
        console.error(e);
    }
}

class GeminiChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'gemini-cli-ui.chatView';
    private _view?: vscode.WebviewView;
    private _activeProcess: GeminiProcess | null = null;
    private _currentSessionId: string = 'latest';
    private _onStateChange: vscode.EventEmitter<'idle' | 'running'>;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _outputChannel: vscode.OutputChannel,
        private readonly _context: vscode.ExtensionContext
    ) {
        this._onStateChange = new vscode.EventEmitter<'idle' | 'running'>();
    }

    private _saveHistory(messages: any[]) {
        const key = `history_${this._currentSessionId}`;
        this._context.workspaceState.update(key, messages);
    }

    private _getHistory(): any[] {
        const key = `history_${this._currentSessionId}`;
        return this._context.workspaceState.get<any[]>(key) || [];
    }

    public get onStateChange() {
        return this._onStateChange.event;
    }

    public async getSessions(): Promise<any[]> {
        const config = vscode.workspace.getConfiguration('gemini');
        let geminiPath = config.get<string>('cliPath');
        if (!geminiPath || geminiPath === 'gemini') {
            geminiPath = '/home/alankrit/.nvm/versions/node/v20.20.2/bin/gemini';
        }
        const nodePath = '/home/alankrit/.nvm/versions/node/v20.20.2/bin/node';
        const fallbackCwd = os.tmpdir();
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || fallbackCwd;

        this._outputChannel.appendLine(`[Extension] Listing sessions with ${nodePath} ${geminiPath} in ${cwd}${cwd === fallbackCwd ? ' (fallback)' : ''}`);

        return new Promise((resolve) => {
            const child = spawn(nodePath, [geminiPath, '--list-sessions'], { cwd, shell: false });
            let stdout = '';
            let errorOccurred = false;

            child.on('error', (err: any) => {
                errorOccurred = true;
                this._outputChannel.appendLine(`[Error] Failed to list sessions: ${err.message}`);
                resolve([]);
            });

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.on('close', (code) => {
                if (errorOccurred) return;
                if (code !== 0) {
                    this._outputChannel.appendLine(`[Error] Failed to list sessions with code: ${code}`);
                    resolve([]);
                    return;
                }

                const sessions: any[] = [];
                const lines = stdout.split('\n');
                const sessionRegex = /^\s*(\d+)\.\s+(.+?)\s+\((.+?)\)\s+\[(.+?)\]/;

                for (const line of lines) {
                    const match = line.match(sessionRegex);
                    if (match) {
                        sessions.push({
                            index: match[1],
                            summary: match[2],
                            age: match[3],
                            id: match[4]
                        });
                    }
                }
                resolve(sessions);
            });

            child.on('error', (err) => {
                this._outputChannel.appendLine(`[Error] Failed to spawn gemini for sessions: ${err.message}`);
                resolve([]);
            });
        });
    }

    public resumeSession(sessionId: string) {
        this._currentSessionId = sessionId;
        vscode.commands.executeCommand('workbench.view.extension.gemini-chat-explorer');
        
        const history = this._getHistory();
        this._view?.webview.postMessage({ command: 'loadHistory', messages: history });
        this._view?.webview.postMessage({ command: 'receiveMessage', text: `Resumed session: ${sessionId}` });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Load existing history
        const history = this._getHistory();
        if (history.length > 0) {
            webviewView.webview.postMessage({ command: 'loadHistory', messages: history });
        }

        webviewView.webview.onDidReceiveMessage(data => {
            this._outputChannel.appendLine(`[Extension] Received from Webview: ${data.command}`);
            switch (data.command) {
                case 'sendMessage':
                    this._onSendMessage(data.text);
                    break;
                case 'updateHistory':
                    this._saveHistory(data.messages);
                    break;
                case 'stopProcess':
                    this._activeProcess?.stop();
                    this._onStateChange.fire('idle');
                    webviewView.webview.postMessage({ command: 'receiveError', text: 'Process stopped by user.' });
                    break;
                case 'clearChat':
                    this._activeProcess?.stop();
                    this._activeProcess = null;
                    this._currentSessionId = 'latest';
                    this._saveHistory([]);
                    break;
            }
        });

        webviewView.onDidDispose(() => {
            this._activeProcess?.stop();
            this._activeProcess = null;
        });
    }

    private _onSendMessage(text: string) {
        if (!this._view) {
            this._outputChannel.appendLine('[Extension] Error: Webview reference is null!');
            return;
        }

        this._activeProcess?.stop();
        this._onStateChange.fire('running');
        this._activeProcess = new GeminiProcess(
            (data) => {
                this._outputChannel.appendLine(`[Extension] UI Update: ${data.substring(0, 30)}...`);
                this._view?.webview.postMessage({ command: 'receiveMessage', text: data });
            },
            (error) => {
                this._outputChannel.appendLine(`[Extension] UI Error: ${error}`);
                this._view?.webview.postMessage({ command: 'receiveError', text: error });
            },
            (code) => {
                this._outputChannel.appendLine(`[Extension] UI Process Exit: ${code}`);
                this._view?.webview.postMessage({ command: 'processExit', code: code });
                this._activeProcess = null;
                this._onStateChange.fire('idle');
            },
            this._outputChannel,
            (suggestion) => {
                this._onCodeSuggestion(suggestion);
            }
        );
        this._activeProcess.start(text, this._currentSessionId);
    }

    private async _onCodeSuggestion(suggestion: { tool: string, parameters: any }) {
        const { tool, parameters } = suggestion;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;

        const cwd = workspaceFolders[0].uri.fsPath;
        const filePath = path.resolve(cwd, parameters.file_path);
        const fileName = path.basename(filePath);

        let originalContent = '';
        if (fs.existsSync(filePath)) {
            originalContent = fs.readFileSync(filePath, 'utf8');
        }

        let newContent = '';
        if (tool === 'write_file') {
            newContent = parameters.content;
        } else if (tool === 'replace') {
            newContent = originalContent.replace(parameters.old_string, parameters.new_string);
        }

        // Create a temporary file for the suggested content
        const tempDir = os.tmpdir();
        const tempFilePath = path.join(tempDir, `gemini-suggestion-${Date.now()}-${fileName}`);
        fs.writeFileSync(tempFilePath, newContent);

        const originalUri = vscode.Uri.file(filePath);
        const tempUri = vscode.Uri.file(tempFilePath);

        await vscode.commands.executeCommand('vscode.diff', originalUri, tempUri, `Gemini: ${fileName} (Suggestion)`);

        const action = await vscode.window.showInformationMessage(
            `Gemini suggested changes to ${fileName}. Do you want to apply them?`,
            'Apply', 'Discard'
        );

        if (action === 'Apply') {
            fs.writeFileSync(filePath, newContent);
            vscode.window.showInformationMessage(`Applied changes to ${fileName}`);
        } else if (action === 'Discard') {
            if ((tool === 'replace' || tool === 'write_file') && fs.existsSync(filePath)) {
                // If it was already applied by the CLI (e.g. in auto_edit mode), we might need to revert.
                const currentContent = fs.readFileSync(filePath, 'utf8');
                if (currentContent === newContent) {
                    fs.writeFileSync(filePath, originalContent);
                    vscode.window.showInformationMessage(`Reverted changes to ${fileName}`);
                }
            }
        }
        
        // Clean up temp file
        try {
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        } catch (e) {}
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { padding: 0; margin: 0; display: flex; flex-direction: column; height: 100vh; background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); overflow: hidden; }
        #chat-container { display: flex; flex-direction: column; height: 100vh; width: 100%; position: relative; }
        #messages { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
        .message { padding: 10px 14px; border-radius: 6px; max-width: 85%; word-wrap: break-word; white-space: pre-wrap; font-size: var(--vscode-font-size); }
        .user-message { align-self: flex-end; background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .assistant-message { align-self: flex-start; background-color: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); color: var(--vscode-editorWidget-foreground); }
        .assistant-message.thinking { font-style: italic; opacity: 0.6; animation: pulse 1.5s infinite; }
        @keyframes pulse { 0% { opacity: 0.3; } 50% { opacity: 0.7; } 100% { opacity: 0.3; } }
        #input-container { padding: 12px; border-top: 1px solid var(--vscode-widget-border); display: flex; flex-direction: column; gap: 10px; background-color: var(--vscode-editor-background); }
        #prompt { width: 100%; min-height: 70px; padding: 8px; background-color: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); resize: none; box-sizing: border-box; }
        #controls { display: flex; gap: 8px; justify-content: flex-end; }
        button { padding: 6px 14px; background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; border-radius: 2px; }
        button:hover { background-color: var(--vscode-button-hoverBackground); }
        #status-bar { font-size: 10px; opacity: 0.7; padding: 4px 12px; border-top: 1px solid var(--vscode-widget-border); background: var(--vscode-sideBar-background); }
    </style>
</head>
<body>
    <div id="chat-container">
        <div id="messages"></div>
        <div id="input-container">
            <textarea id="prompt" placeholder="Ask Gemini..."></textarea>
            <div id="controls">
                <button id="clear-btn">Clear</button>
                <button id="send-btn">Send</button>
            </div>
        </div>
        <div id="status-bar">Ready</div>
    </div>
    <script>
        (function() {
            const vscode = acquireVsCodeApi();
            const msgContainer = document.getElementById('messages');
            const input = document.getElementById('prompt');
            const status = document.getElementById('status-bar');
            let messages = [];
            let currentMsg = null;
            let thinking = null;

            function add(text, type, skipSave = false) {
                const div = document.createElement('div');
                div.className = 'message ' + type + '-message';
                div.textContent = text;
                msgContainer.appendChild(div);
                msgContainer.scrollTop = msgContainer.scrollHeight;
                
                if (!skipSave && type !== 'thinking') {
                    messages.push({ text, type });
                    vscode.postMessage({ command: 'updateHistory', messages: messages });
                }
                return div;
            }

            function handleSend() {
                const text = input.value.trim();
                if (!text) return;
                add(text, 'user');
                thinking = add('Gemini is thinking...', 'assistant', true);
                thinking.classList.add('thinking');
                vscode.postMessage({ command: 'sendMessage', text: text });
                input.value = '';
                currentMsg = null;
            }

            document.getElementById('send-btn').onclick = handleSend;
            input.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend(); };
            document.getElementById('clear-btn').onclick = () => { 
                msgContainer.innerHTML = ''; 
                messages = [];
                vscode.postMessage({ command: 'clearChat' }); 
            };

            window.addEventListener('message', event => {
                const m = event.data;
                
                if (m.command === 'loadHistory') {
                    msgContainer.innerHTML = '';
                    messages = m.messages || [];
                    messages.forEach(msg => add(msg.text, msg.type, true));
                    return;
                }

                if (thinking) { thinking.remove(); thinking = null; }
                
                if (m.command === 'receiveMessage') {
                    if (m.text.startsWith('[Tool')) {
                        add(m.text, 'assistant');
                        currentMsg = null;
                    } else {
                        if (!currentMsg) {
                            currentMsg = add(m.text, 'assistant');
                        } else { 
                            currentMsg.textContent += m.text; 
                            // Update the last message in history
                            const lastMsg = messages[messages.length - 1];
                            if (lastMsg && lastMsg.type === 'assistant') {
                                lastMsg.text = currentMsg.textContent;
                                vscode.postMessage({ command: 'updateHistory', messages: messages });
                            }
                            msgContainer.scrollTop = msgContainer.scrollHeight; 
                        }
                    }
                } else if (m.command === 'receiveError') {
                    add('Error: ' + m.text, 'assistant');
                } else if (m.command === 'processExit') {
                    currentMsg = null;
                }
            });
        })();
    </script>
</body>
</html>`;
    }
}

export function deactivate() {}

class GeminiSessionsProvider implements vscode.TreeDataProvider<SessionItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SessionItem | undefined | null | void> = new vscode.EventEmitter<SessionItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SessionItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private readonly outputChannel: vscode.OutputChannel) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SessionItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SessionItem): Promise<SessionItem[]> {
        if (element) return [];

        const config = vscode.workspace.getConfiguration('gemini');
        let geminiPath = config.get<string>('cliPath');
        if (!geminiPath || geminiPath === 'gemini') {
            geminiPath = '/home/alankrit/.nvm/versions/node/v20.20.2/bin/gemini';
        }
        const nodePath = '/home/alankrit/.nvm/versions/node/v20.20.2/bin/node';
        const fallbackCwd = os.tmpdir();
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || fallbackCwd;

        this.outputChannel.appendLine(`[Extension] Loading session tree from ${nodePath} ${geminiPath} in ${cwd}${cwd === fallbackCwd ? ' (fallback)' : ''}`);

        return new Promise((resolve) => {
            const child = spawn(nodePath, [geminiPath, '--list-sessions'], { cwd, shell: false });
            let stdout = '';
            let errorOccurred = false;

            child.on('error', (err: any) => {
                errorOccurred = true;
                if (err.code === 'ENOENT') {
                    this.outputChannel.appendLine(`[Error] Gemini CLI not found at '${geminiPath}'. Please check VS Code settings.`);
                    vscode.window.showErrorMessage(`Gemini CLI not found at '${geminiPath}'. Please ensure it is installed and in your PATH.`);
                } else {
                    this.outputChannel.appendLine(`[Error] Failed to spawn Gemini CLI: ${err.message}`);
                }
                resolve([]);
            });

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.on('close', (code) => {
                if (errorOccurred) return;

                if (code !== 0) {
                    this.outputChannel.appendLine(`[Error] Failed to list sessions with code: ${code}`);
                    resolve([]);
                    return;
                }

                const sessions: SessionItem[] = [];
                const lines = stdout.split(/\r?\n/);
                const sessionRegex = /^\s*(\d+)\.\s+(.+?)\s+\((.+?)\)\s+\[(.+?)\]/;

                for (const line of lines) {
                    const match = line.match(sessionRegex);
                    if (match) {
                        const [_, index, summary, age, id] = match;
                        sessions.push(new SessionItem(
                            summary.trim(),
                            age.trim(),
                            id.trim(),
                            vscode.TreeItemCollapsibleState.None,
                            {
                                command: 'gemini-cli-ui.resumeSessionFromTree',
                                title: 'Resume Session',
                                arguments: [id.trim()]
                            }
                        ));
                    }
                }
                resolve(sessions);
            });
        });
    }
}

class SessionItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly id: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
        this.tooltip = `${this.label} (${this.description})`;
        this.contextValue = 'session';
        this.iconPath = new vscode.ThemeIcon('history');
    }
}
