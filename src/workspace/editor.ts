import {
	editorWindowExists,
	focusAndPositionEditor,
	getSidebarBounds,
	positionEditorWindow,
} from "./window.ts";

export async function openEditor(worktreePath: string, editor: string): Promise<void> {
	Bun.spawn([editor, "--new-window", worktreePath], {
		stdout: "ignore",
		stderr: "ignore",
	});

	// Wait for the VS Code window to actually appear (up to 10 seconds)
	for (let i = 0; i < 20; i++) {
		await Bun.sleep(500);
		if (await editorWindowExists(worktreePath)) break;
	}

	const sidebar = await getSidebarBounds();
	if (sidebar) {
		await positionEditorWindow(worktreePath, sidebar);
	}
}

export async function focusEditor(worktreePath: string, _editor: string): Promise<boolean> {
	return focusAndPositionEditor(worktreePath);
}
