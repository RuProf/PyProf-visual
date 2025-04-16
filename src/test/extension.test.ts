import * as assert from 'assert';
import * as vscode from 'vscode';

describe('PyProf-visual Extension Test Suite', () => {
    before(async () => {
        const extension = vscode.extensions.getExtension('RuProf.PyProf-visual');
        if (extension) {
            await extension.activate();
        }
    });

    it('Extension should be present', () => {
        const extension = vscode.extensions.getExtension('RuProf.PyProf-visual');
        assert.ok(extension, 'Extension not found');
    });

    it('Command should be registered', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('PyProfVisual.open'), 'Command not registered');
    });
});