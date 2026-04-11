import {
	focusAndPositionEditor,
	getSidebarBounds,
	positionEditorWindow,
	editorWindowExists,
} from "./window.ts";

export async function openEditor(worktreePath: string, editor: string): Promise<void> {
	Bun.spawn([editor, "--new-window", worktreePath], {
		stdout: "ignore",
		stderr: "ignore",
	});

	const basename = worktreePath.split("/").pop() ?? "";

	// Wait for the VS Code window to actually appear (up to 10 seconds)
	for (let i = 0; i < 20; i++) {
		await Bun.sleep(500);
		if (await editorWindowExists(basename)) break;
	}

	// Position the new window next to the sidebar
	const sidebar = await getSidebarBounds();
	if (sidebar) {
		await positionEditorWindow(basename, sidebar);
	}
}

export async function focusEditor(worktreePath: string, _editor: string): Promise<boolean> {
	const basename = worktreePath.split("/").pop() ?? "";
	return focusAndPositionEditor(basename);
}
