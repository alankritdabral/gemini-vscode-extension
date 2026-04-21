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
class GeminiProcess {
    process = null;
    onDataCallback;
    onErrorCallback;
    onExitCallback;
    isActive = false;
    _buffer = '';
    outputChannel;
    constructor(onData, onError, onExit, outputChannel) {
        this.onDataCallback = onData;
        this.onErrorCallback = onError;
        this.onExitCallback = onExit;
        this.outputChannel = outputChannel;
    }
    start(prompt, sessionId = 'latest') {
        if (this.process) {
            this.stop();
        }
        try {
            const config = vscode.workspace.getConfiguration('gemini');
            const geminiPath = config.get('cliPath') || 'gemini';
            const cwd = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            this.outputChannel.appendLine(`[Extension] Attempting to spawn: ${geminiPath}`);
            const args = ['-p', prompt, '-r', sessionId, '--output-format', 'stream-json'];
            // Use shell: true only on Windows or if path contains spaces
            const useShell = process.platform === 'win32' || geminiPath.includes(' ');
            this.process = (0, node_child_process_1.spawn)(geminiPath, args, {
                env: { ...process.env, FORCE_COLOR: '0', PYTHONUNBUFFERED: '1' },
                shell: useShell,
                cwd: cwd
            });
            if (!this.process) {
                throw new Error('Spawn returned null process.');
            }
            this.process.on('spawn', () => {
                this.outputChannel.appendLine(`[Extension] Process spawned successfully (PID: ${this.process?.pid})`);
            });
            this.isActive = true;
            this.process.stdout.on('data', (data) => {
                const rawText = data.toString();
                this.outputChannel.append(`[STDOUT] ${rawText}`);
                this._buffer += rawText;
                let lineEndIndex;
                while (true) {
                    const nIndex = this._buffer.indexOf('\\n');
                    const rIndex = this._buffer.indexOf('\\r');
                    if (nIndex === -1 && rIndex === -1) {
                        break;
                    }
                    if (nIndex !== -1 && (rIndex === -1 || nIndex < rIndex)) {
                        lineEndIndex = nIndex;
                    }
                    else {
                        lineEndIndex = rIndex;
                    }
                    const line = this._buffer.slice(0, lineEndIndex).trim();
                    this._buffer = this._buffer.slice(lineEndIndex + 1);
                    // Handle \r\n
                    if (lineEndIndex === rIndex && this._buffer.startsWith('\\n')) {
                        this._buffer = this._buffer.slice(1);
                    }
                    if (line.startsWith('{')) {
                        try {
                            const event = JSON.parse(line);
                            this.handleEvent(event);
                        }
                        catch (e) {
                            // Only log if it really looks like JSON
                            if (line.includes('"type":')) {
                                console.error('Failed to parse JSON:', line, e);
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
                this.isActive = false;
                this.onExitCallback(code);
                this.process = null;
            });
            this.process.on('error', (err) => {
                this.isActive = false;
                if (err.code === 'ENOENT') {
                    vscode.window.showErrorMessage(`Gemini CLI not found at "${geminiPath}". Please ensure it is installed and in your PATH.`, 'Open Settings').then(selection => {
                        if (selection === 'Open Settings') {
                            vscode.commands.executeCommand('workbench.action.openSettings', 'gemini.cliPath');
                        }
                    });
                }
                else {
                    this.onErrorCallback(err.message);
                }
            });
        }
        catch (error) {
            this.isActive = false;
            this.onErrorCallback(error.message);
        }
    }
    sendInput(text) {
        // No longer used for single-query approach
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
            this.onDataCallback(`[Tool Use: ${event.tool_name}]`);
        }
        else if (event.type === 'error') {
            this.onErrorCallback(event.message || 'Unknown error');
        }
        else if (event.type === 'result' && event.status === 'error') {
            this.onErrorCallback(event.error || 'Process failed');
        }
    }
    stripAnsi(text) {
        // eslint-disable-next-line no-control-regex
        const ansiRegex = /[\\u001b\\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
        return text.replace(ansiRegex, '');
    }
}
exports.GeminiProcess = GeminiProcess;
//# sourceMappingURL=geminiProcess.js.map