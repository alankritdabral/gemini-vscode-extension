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
            const cwd = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            
            this.outputChannel.appendLine(`[Extension] Attempting to spawn: ${geminiPath}`);
            
            const args = ['-p', prompt, '-r', sessionId, '--output-format', 'stream-json'];

            // Use shell: true only on Windows or if path contains spaces
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
                
                let lineEndIndex;
                while (true) {
                    const nIndex = this._buffer.indexOf('\\n');
                    const rIndex = this._buffer.indexOf('\\r');
                    
                    if (nIndex === -1 && rIndex === -1) { break; }
                    
                    if (nIndex !== -1 && (rIndex === -1 || nIndex < rIndex)) {
                        lineEndIndex = nIndex;
                    } else {
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
                        } catch (e) {
                            // Only log if it really looks like JSON
                            if (line.includes('"type":')) {
                                console.error('Failed to parse JSON:', line, e);
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
                this.isActive = false;
                this.onExitCallback(code);
                this.process = null;
            });

            this.process.on('error', (err: any) => {
                this.isActive = false;
                if (err.code === 'ENOENT') {
                    vscode.window.showErrorMessage(
                        `Gemini CLI not found at "${geminiPath}". Please ensure it is installed and in your PATH.`,
                        'Open Settings'
                    ).then(selection => {
                        if (selection === 'Open Settings') {
                            vscode.commands.executeCommand('workbench.action.openSettings', 'gemini.cliPath');
                        }
                    });
                } else {
                    this.onErrorCallback(err.message);
                }
            });

        } catch (error: any) {
            this.isActive = false;
            this.onErrorCallback(error.message);
        }
    }

    public sendInput(text: string) {
        // No longer used for single-query approach
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
        // eslint-disable-next-line no-control-regex
        const ansiRegex = /[\\u001b\\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
        return text.replace(ansiRegex, '');
    }
}
