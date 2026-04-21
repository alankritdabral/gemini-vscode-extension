import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

    test('Gemini Commands registered', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('gemini-cli-ui.openChat'));
        assert.ok(commands.includes('gemini-cli-ui.resumeSession'));
        assert.ok(commands.includes('gemini-cli-ui.refreshSessions'));
    });
});
