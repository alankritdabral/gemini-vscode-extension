(function () {
    const vscode = acquireVsCodeApi();

    const messagesContainer = document.getElementById('messages');
    const promptInput = document.getElementById('prompt');
    const sendBtn = document.getElementById('send-btn');
    const stopBtn = document.getElementById('stop-btn');
    const clearBtn = document.getElementById('clear-btn');

    let currentAssistantMessage = null;

    function addMessage(text, type) {
        const div = document.createElement('div');
        div.className = `message ${type}-message`;
        div.textContent = text;
        messagesContainer.appendChild(div);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return div;
    }

    function appendToMessage(div, text) {
        div.textContent += text;
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    sendBtn.addEventListener('click', () => {
        const text = promptInput.value.trim();
        if (text) {
            addMessage(text, 'user');
            currentAssistantMessage = null; // Reset for new turn
            vscode.postMessage({ command: 'sendMessage', text: text });
            promptInput.value = '';
        }
    });

    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            sendBtn.click();
        }
    });

    stopBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'stopProcess' });
    });

    clearBtn.addEventListener('click', () => {
        messagesContainer.innerHTML = '';
        currentAssistantMessage = null;
        vscode.postMessage({ command: 'clearChat' });
    });

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
            case 'receiveMessage':
                // Check if it's a tool use marker
                if (message.text.startsWith('[Tool Use:')) {
                    addMessage(message.text, 'assistant');
                    currentAssistantMessage = null; // Next message should be new
                } else {
                    if (!currentAssistantMessage) {
                        currentAssistantMessage = addMessage(message.text, 'assistant');
                    } else {
                        appendToMessage(currentAssistantMessage, message.text);
                    }
                }
                break;
            case 'receiveError':
                addMessage(message.text, 'error');
                currentAssistantMessage = null;
                break;
            case 'processExit':
                if (message.code !== 0 && message.code !== null) {
                    addMessage(`Process exited with code ${message.code}`, 'error');
                }
                currentAssistantMessage = null;
                break;
        }
    });
}());
