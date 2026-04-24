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
exports.GeminiProcess = void 0;
const node_child_process_1 = require("node:child_process");
const vscode = __importStar(require("vscode"));
const os = __importStar(require("node:os"));
class GeminiProcess {
    process = null;
    onDataCallback;
    onErrorCallback;
    onExitCallback;
    onSuggestionCallback;
    isActive = false;
    _buffer = '';
    outputChannel;
    constructor(onData, onError, onExit, outputChannel, onSuggestion) {
        this.onDataCallback = onData;
        this.onErrorCallback = onError;
        this.onExitCallback = onExit;
        this.outputChannel = outputChannel;
        this.onSuggestionCallback = onSuggestion;
    }
    async fetchHistory(sessionId) {
        return new Promise((resolve) => {
            const history = [];
            const config = vscode.workspace.getConfiguration('gemini');
            let geminiPath = config.get('cliPath');
            if (!geminiPath || geminiPath === 'gemini') {
                geminiPath = '/home/alankrit/.nvm/versions/node/v20.20.2/bin/gemini';
            }
            const nodePath = '/home/alankrit/.nvm/versions/node/v20.20.2/bin/node';
            const fallbackCwd = os.tmpdir();
            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || fallbackCwd;
            const args = [
                geminiPath,
                '-r', sessionId,
                '--output-format', 'stream-json',
                '--approval-mode', 'plan' // Use plan mode for read-only history fetching
            ];
            const child = (0, node_child_process_1.spawn)(nodePath, args, {
                env: {
                    ...process.env,
                    FORCE_COLOR: '0',
                    PYTHONUNBUFFERED: '1',
                    GEMINI_CLI_TRUST_WORKSPACE: 'true'
                },
                shell: false,
                cwd: cwd
            });
            let buffer = '';
            let timer;
            const cleanup = () => {
                clearTimeout(timer);
                if (child.connected) {
                    child.kill();
                }
            };
            // We give it some time to dump history. 
            // If no new messages for 1 second, we assume history is done.
            const resetTimer = () => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    cleanup();
                    resolve(history);
                }, 1500);
            };
            resetTimer();
            child.stdout.on('data', (data) => {
                resetTimer();
                buffer += data.toString();
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('{')) {
                        try {
                            const event = JSON.parse(trimmed);
                            if (event.type === 'message') {
                                history.push({ text: event.content, type: event.role === 'user' ? 'user' : 'assistant' });
                            }
                            else if (event.type === 'tool_use') {
                                history.push({ text: `[Tool Use: ${event.tool_name}]`, type: 'assistant' });
                            }
                        }
                        catch (e) { }
                    }
                }
            });
            child.on('close', () => {
                clearTimeout(timer);
                resolve(history);
            });
            child.on('error', () => {
                clearTimeout(timer);
                resolve(history);
            });
        });
    }
    start(prompt, sessionId = 'latest') {
        if (this.process) {
            this.stop();
        }
        try {
            const config = vscode.workspace.getConfiguration('gemini');
            let geminiPath = config.get('cliPath');
            if (!geminiPath || geminiPath === 'gemini') {
                geminiPath = '/home/alankrit/.nvm/versions/node/v20.20.2/bin/gemini';
            }
            const nodePath = '/home/alankrit/.nvm/versions/node/v20.20.2/bin/node';
            const fallbackCwd = os.tmpdir();
            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || fallbackCwd;
            this.outputChannel.appendLine(`[Extension] Attempting to spawn: ${nodePath} ${geminiPath} in ${cwd}${cwd === fallbackCwd ? ' (fallback)' : ''}`);
            const args = [
                geminiPath,
                '-p', prompt,
                '-r', sessionId,
                '--output-format', 'stream-json',
                '--approval-mode', 'auto_edit'
            ];
            this.process = (0, node_child_process_1.spawn)(nodePath, args, {
                env: {
                    ...process.env,
                    FORCE_COLOR: '0',
                    PYTHONUNBUFFERED: '1',
                    GEMINI_CLI_TRUST_WORKSPACE: 'true'
                },
                shell: false,
                cwd: cwd
            });
            if (!this.process) {
                throw new Error('Spawn returned null process.');
            }
            this.process.on('error', (err) => {
                if (err.code === 'ENOENT') {
                    this.onErrorCallback(`Error: '${nodePath}' or '${geminiPath}' not found. Please ensure Node v20 and Gemini CLI are installed.`);
                }
                else {
                    this.onErrorCallback(`Process error: ${err.message}`);
                }
                this.isActive = false;
            });
            this.process.on('spawn', () => {
                this.outputChannel.appendLine(`[Extension] Process spawned successfully (PID: ${this.process?.pid})`);
            });
            this.isActive = true;
            this.process.stdout.on('data', (data) => {
                const rawText = data.toString();
                this.outputChannel.append(`[STDOUT] ${rawText}`);
                this._buffer += rawText;
                const lines = this._buffer.split(/\r?\n/);
                this._buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('{')) {
                        try {
                            const event = JSON.parse(trimmed);
                            this.handleEvent(event);
                        }
                        catch (e) {
                            if (trimmed.includes('"type":')) {
                                this.outputChannel.appendLine(`[Extension] JSON Parse Error: ${e}`);
                            }
                        }
                    }
                }
            });
            this.process.stderr.on('data', (data) => {
                const rawText = data.toString();
                this.outputChannel.append(`[STDERR] ${rawText}`);
                const text = this.stripAnsi(rawText);
                if (text.toLowerCase().includes('error') && !text.includes('IDEClient')) {
                    this.onErrorCallback(text);
                }
            });
            this.process.on('close', (code) => {
                this.outputChannel.appendLine(`[Extension] Gemini CLI exited with code: ${code}`);
                // Final flush
                if (this._buffer.trim().startsWith('{')) {
                    try {
                        const event = JSON.parse(this._buffer.trim());
                        this.handleEvent(event);
                    }
                    catch (e) { }
                }
                this.isActive = false;
                this.onExitCallback(code);
                this.process = null;
            });
        }
        catch (error) {
            this.isActive = false;
            this.onErrorCallback(error.message);
        }
    }
    stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
            this.isActive = false;
        }
    }
    handleEvent(event) {
        if (event.type === 'message' && event.role === 'assistant') {
            if (event.content) {
                this.onDataCallback(event.content);
            }
        }
        else if (event.type === 'tool_use') {
            this.outputChannel.appendLine(`[Extension] Tool Use: ${event.tool_name} with params: ${JSON.stringify(event.parameters)}`);
            if (event.tool_name === 'write_file' || event.tool_name === 'replace') {
                if (this.onSuggestionCallback) {
                    this.onSuggestionCallback({ tool: event.tool_name, parameters: event.parameters });
                }
            }
            else {
                this.onDataCallback(`[Tool Use: ${event.tool_name}]`);
            }
        }
        else if (event.type === 'error') {
            this.onErrorCallback(event.message || 'Unknown error');
        }
        else if (event.type === 'result' && event.status === 'error') {
            this.onErrorCallback(event.error || 'Process failed');
        }
    }
    stripAnsi(text) {
        const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
        return text.replace(ansiRegex, '');
    }
}
exports.GeminiProcess = GeminiProcess;
//# sourceMappingURL=geminiProcess.js.map