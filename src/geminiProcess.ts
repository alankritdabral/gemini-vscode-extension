import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import * as vscode from 'vscode';
import * as os from 'node:os';

export class GeminiProcess {
    private process: ChildProcessWithoutNullStreams | null = null;
    private onDataCallback: (data: string) => void;
    private onErrorCallback: (error: string) => void;
    private onExitCallback: (code: number | null) => void;
    private onSuggestionCallback?: (suggestion: { tool: string, parameters: any }) => void;
    public isActive: boolean = false;
    private _buffer: string = '';

    private outputChannel: vscode.OutputChannel;

    constructor(
        onData: (data: string) => void,
        onError: (error: string) => void,
        onExit: (code: number | null) => void,
        outputChannel: vscode.OutputChannel,
        onSuggestion?: (suggestion: { tool: string, parameters: any }) => void
    ) {
        this.onDataCallback = onData;
        this.onErrorCallback = onError;
        this.onExitCallback = onExit;
        this.outputChannel = outputChannel;
        this.onSuggestionCallback = onSuggestion;
    }

    public start(prompt: string, sessionId: string = 'latest') {
        if (this.process) {
            this.stop();
        }

        try {
            const config = vscode.workspace.getConfiguration('gemini');
            let geminiPath = config.get<string>('cliPath');
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

            this.process = spawn(nodePath, args, {
                env: { ...process.env, FORCE_COLOR: '0', PYTHONUNBUFFERED: '1' },
                shell: false,
                cwd: cwd
            });

            if (!this.process) {
                throw new Error('Spawn returned null process.');
            }

            this.process.on('error', (err: any) => {
                if (err.code === 'ENOENT') {
                    this.onErrorCallback(`Error: '${nodePath}' or '${geminiPath}' not found. Please ensure Node v20 and Gemini CLI are installed.`);
                } else {
                    this.onErrorCallback(`Process error: ${err.message}`);
                }
                this.isActive = false;
            });

            this.process.on('spawn', () => {
                this.outputChannel.appendLine(`[Extension] Process spawned successfully (PID: ${this.process?.pid})`);
            });

            this.isActive = true;

            this.process.stdout.on('data', (data: Buffer) => {
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
                        } catch (e) {
                            if (trimmed.includes('"type":')) {
                                this.outputChannel.appendLine(`[Extension] JSON Parse Error: ${e}`);
                            }
                        }
                    }
                }
            });

            this.process.stderr.on('data', (data: Buffer) => {
                const rawText = data.toString();
                this.outputChannel.append(`[STDERR] ${rawText}`);
                
                const text = this.stripAnsi(rawText);
                if (text.toLowerCase().includes('error') && !text.includes('IDEClient')) {
                    this.onErrorCallback(text);
                }
            });

            this.process.on('close', (code: number | null) => {
                this.outputChannel.appendLine(`[Extension] Gemini CLI exited with code: ${code}`);
                
                // Final flush
                if (this._buffer.trim().startsWith('{')) {
                    try {
                        const event = JSON.parse(this._buffer.trim());
                        this.handleEvent(event);
                    } catch (e) {}
                }
                
                this.isActive = false;
                this.onExitCallback(code);
                this.process = null;
            });

        } catch (error: any) {
            this.isActive = false;
            this.onErrorCallback(error.message);
        }
    }

    public stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
            this.isActive = false;
        }
    }

    private handleEvent(event: any) {
        if (event.type === 'message' && event.role === 'assistant') {
            if (event.content) {
                this.onDataCallback(event.content);
            }
        } else if (event.type === 'tool_use') {
            this.outputChannel.appendLine(`[Extension] Tool Use: ${event.tool_name} with params: ${JSON.stringify(event.parameters)}`);
            
            if (event.tool_name === 'write_file' || event.tool_name === 'replace') {
                if (this.onSuggestionCallback) {
                    this.onSuggestionCallback({ tool: event.tool_name, parameters: event.parameters });
                }
            } else {
                this.onDataCallback(`[Tool Use: ${event.tool_name}]`);
            }
        } else if (event.type === 'error') {
            this.onErrorCallback(event.message || 'Unknown error');
        } else if (event.type === 'result' && event.status === 'error') {
            this.onErrorCallback(event.error || 'Process failed');
        }
    }

    private stripAnsi(text: string): string {
        const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
        return text.replace(ansiRegex, '');
    }
}
