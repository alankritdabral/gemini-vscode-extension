import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import * as vscode from 'vscode';

export class GeminiProcess {
    private process: ChildProcessWithoutNullStreams | null = null;
    private onDataCallback: (data: string) => void;
    private onErrorCallback: (error: string) => void;
    private onExitCallback: (code: number | null) => void;
    public isActive: boolean = false;
    private _buffer: string = '';

    private outputChannel: vscode.OutputChannel;

    constructor(
        onData: (data: string) => void,
        onError: (error: string) => void,
        onExit: (code: number | null) => void,
        outputChannel: vscode.OutputChannel
    ) {
        this.onDataCallback = onData;
        this.onErrorCallback = onError;
        this.onExitCallback = onExit;
        this.outputChannel = outputChannel;
    }

    public start(prompt: string, sessionId: string = 'latest') {
        if (this.process) {
            this.stop();
        }

        try {
            const config = vscode.workspace.getConfiguration('gemini');
            const geminiPath = config.get<string>('cliPath') || 'gemini';
            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            
            this.outputChannel.appendLine(`[Extension] Attempting to spawn: ${geminiPath} in ${cwd}`);
            
            const args = ['-p', prompt, '-r', sessionId, '--output-format', 'stream-json'];
            const useShell = process.platform === 'win32' || geminiPath.includes(' ');

            this.process = spawn(geminiPath, args, {
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

            this.process.on('error', (err: any) => {
                this.isActive = false;
                this.outputChannel.appendLine(`[Extension] Process Error: ${err.message}`);
                this.onErrorCallback(err.message);
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
            this.onDataCallback(`[Tool Use: ${event.tool_name}]`);
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
