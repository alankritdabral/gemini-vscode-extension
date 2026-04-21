const mockVscode = {
    window: {
        createOutputChannel: () => ({ appendLine: console.log }),
        createStatusBarItem: () => ({ show: () => {} }),
        registerWebviewViewProvider: () => {}
    },
    StatusBarAlignment: { Right: 1 },
    EventEmitter: class { event = {} },
    commands: { registerCommand: () => {} },
    ThemeColor: class {}
};

// Mock vscode module
require.cache[require.resolve('vscode')] = {
    id: 'vscode',
    filename: 'vscode',
    loaded: true,
    exports: mockVscode
};

try {
    console.log('Attempting to load extension...');
    require('./out/extension.js');
    console.log('Successfully loaded extension.');
} catch (e) {
    console.error('Failed to load extension:', e);
}
