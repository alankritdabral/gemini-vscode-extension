"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const geminiProcess_1 = require("./geminiProcess");
const node_child_process_1 = require("node:child_process");
function activate(context) {
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
            }
            else {
                statusItem.text = '$(sparkle) Gemini: Idle';
                statusItem.backgroundColor = undefined;
            }
        });
        context.subscriptions.push(vscode.window.registerWebviewViewProvider(GeminiChatViewProvider.viewType, provider));
        context.subscriptions.push(vscode.commands.registerCommand('gemini-cli-ui.openChat', () => {
            vscode.commands.executeCommand('workbench.view.extension.gemini-chat-explorer');
        }));
        context.subscriptions.push(vscode.commands.registerCommand('gemini-cli-ui.resumeSession', async () => {
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
        }));
    }
    catch (e) {
        vscode.window.showErrorMessage(`Failed to activate Gemini CLI UI: ${e.message}`);
        console.error(e);
    }
}
class GeminiChatViewProvider {
    _extensionUri;
    _outputChannel;
    static viewType = 'gemini-cli-ui.chatView';
    _view;
    _activeProcess = null;
    _currentSessionId = 'latest';
    _onStateChange;
    constructor(_extensionUri, _outputChannel) {
        this._extensionUri = _extensionUri;
        this._outputChannel = _outputChannel;
        this._onStateChange = new vscode.EventEmitter();
    }
    get onStateChange() {
        return this._onStateChange.event;
    }
    async getSessions() {
        const config = vscode.workspace.getConfiguration('gemini');
        const geminiPath = config.get('cliPath') || 'gemini';
        const cwd = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        return new Promise((resolve) => {
            const child = (0, node_child_process_1.spawn)(geminiPath, ['--list-sessions'], { cwd, shell: true });
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
                const sessions = [];
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
    resumeSession(sessionId) {
        this._currentSessionId = sessionId;
        vscode.commands.executeCommand('workbench.view.extension.gemini-chat-explorer');
        this._view?.webview.postMessage({ command: 'receiveMessage', text: `Resumed session: ${sessionId}` });
    }
    resolveWebviewView(webviewView, _context, _token) {
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
    _onSendMessage(text) {
        this._activeProcess?.stop();
        this._onStateChange.fire('running');
        this._activeProcess = new geminiProcess_1.GeminiProcess((data) => this._view?.webview.postMessage({ command: 'receiveMessage', text: data }), (error) => this._view?.webview.postMessage({ command: 'receiveError', text: error }), (code) => {
            this._view?.webview.postMessage({ command: 'processExit', code: code });
            this._activeProcess = null;
            this._onStateChange.fire('idle');
        }, this._outputChannel);
        this._activeProcess.start(text, this._currentSessionId);
    }
    _getHtmlForWebview(webview) {
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
function deactivate() { }
//# sourceMappingURL=extension.js.map