import * as vscode from 'vscode';
import { GeminiProcess } from './geminiProcess';
import { spawn } from 'node:child_process';

export function activate(context: vscode.ExtensionContext) {
    try {
        console.log('Gemini CLI Extension Host started');
        const outputChannel = vscode.window.createOutputChannel('Gemini CLI');
        context.subscriptions.push(outputChannel);

        const provider = new GeminiChatViewProvider(context.extensionUri, outputChannel);

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
        private readonly _outputChannel: vscode.OutputChannel
    ) {
        this._onStateChange = new vscode.EventEmitter<'idle' | 'running'>();
    }

    public get onStateChange() {
        return this._onStateChange.event;
    }

    public async getSessions(): Promise<any[]> {
        const config = vscode.workspace.getConfiguration('gemini');
        const geminiPath = config.get<string>('cliPath') || 'gemini';
        const cwd = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

        return new Promise((resolve) => {
            const child = spawn(geminiPath, ['--list-sessions'], { cwd, shell: true });
            let stdout = '';
            
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.on('close', (code) => {
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

        webviewView.webview.onDidReceiveMessage(data => {
            this._outputChannel.appendLine(`[Extension] Received message from webview: ${data.command}`);
            switch (data.command) {
                case 'sendMessage':
                    this._onSendMessage(data.text);
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
                    break;
            }
        });

        webviewView.onDidDispose(() => {
            this._activeProcess?.stop();
            this._activeProcess = null;
        });
    }

    private _onSendMessage(text: string) {
        this._activeProcess?.stop();
        this._onStateChange.fire('running');
        this._activeProcess = new GeminiProcess(
            (data) => this._view?.webview.postMessage({ command: 'receiveMessage', text: data }),
            (error) => this._view?.webview.postMessage({ command: 'receiveError', text: error }),
            (code) => {
                this._view?.webview.postMessage({ command: 'processExit', code: code });
                this._activeProcess = null;
                this._onStateChange.fire('idle');
            },
            this._outputChannel
        );
        this._activeProcess.start(text, this._currentSessionId);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>Gemini CLI</title>
</head>
<body>
    <div id="chat-container">
        <div id="messages"></div>
        <div id="input-container">
            <textarea id="prompt" placeholder="Ask Gemini... (Ctrl+Enter to send)"></textarea>
            <div id="controls">
                <button id="send-btn">Send</button>
                <button id="stop-btn">Stop</button>
                <button id="clear-btn">Clear</button>
            </div>
        </div>
    </div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}

export function deactivate() {}
