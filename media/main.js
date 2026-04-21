(function () {
    const vscode = acquireVsCodeApi();

    // DOM Elements
    let messagesContainer;
    let promptInput;
    let sendBtn;
    let stopBtn;
    let clearBtn;

    let currentAssistantMessage = null;
    let thinkingMessage = null;

    function init() {
        messagesContainer = document.getElementById('messages');
        promptInput = document.getElementById('prompt');
        sendBtn = document.getElementById('send-btn');
        stopBtn = document.getElementById('stop-btn');
        clearBtn = document.getElementById('clear-btn');

        if (!messagesContainer || !promptInput || !sendBtn) {
            console.error('[Webview] Failed to find essential DOM elements');
            return;
        }

        console.log('[Webview] Initialized correctly');

        sendBtn.addEventListener('click', handleSend);
        promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                handleSend();
            }
        });

        stopBtn?.addEventListener('click', () => {
            removeThinking();
            vscode.postMessage({ command: 'stopProcess' });
        });

        clearBtn?.addEventListener('click', () => {
            messagesContainer.innerHTML = '';
            currentAssistantMessage = null;
            removeThinking();
            vscode.postMessage({ command: 'clearChat' });
        });
    }

    function handleSend() {
        const text = promptInput.value.trim();
        if (text) {
            console.log('[Webview] Sending message:', text);
            addMessage(text, 'user');
            currentAssistantMessage = null; 
            removeThinking();
            thinkingMessage = addMessage('Gemini is thinking...', 'assistant');
            thinkingMessage.classList.add('thinking');
            
            vscode.postMessage({ command: 'sendMessage', text: text });
            promptInput.value = '';
        }
    }

    function addMessage(text, type) {
        if (!messagesContainer) return;
        const div = document.createElement('div');
        div.className = `message ${type}-message`;
        div.textContent = text;
        messagesContainer.appendChild(div);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return div;
    }

    function appendToMessage(div, text) {
        if (!div) return;
        div.textContent += text;
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    function removeThinking() {
        if (thinkingMessage) {
            thinkingMessage.remove();
            thinkingMessage = null;
        }
    }

    // Handle messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('[Webview] Received from extension:', message);
        
        try {
            switch (message.command) {
                case 'receiveMessage':
                    removeThinking();
                    if (message.text.startsWith('[Tool Use:')) {
                        addMessage(message.text, 'assistant');
                        currentAssistantMessage = null;
                    } else {
                        if (!currentAssistantMessage) {
                            currentAssistantMessage = addMessage(message.text, 'assistant');
                        } else {
                            appendToMessage(currentAssistantMessage, message.text);
                        }
                    }
                    break;
                case 'receiveError':
                    removeThinking();
                    addMessage(message.text, 'error');
                    currentAssistantMessage = null;
                    break;
                case 'processExit':
                    removeThinking();
                    if (message.code !== 0 && message.code !== null) {
                        addMessage(`Process exited with code ${message.code}`, 'error');
                    }
                    currentAssistantMessage = null;
                    break;
            }
        } catch (err) {
            console.error('[Webview] Error handling message:', err);
        }
    });

    // Run init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
