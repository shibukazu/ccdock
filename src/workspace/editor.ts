import type { HubConfig } from "../types.ts";
import {
	editorWindowExists,
	focusAndPositionEditor,
	getSidebarBounds,
	positionEditorWindow,
} from "./window.ts";

// VS Code (and Cursor, which forks the same Electron app) splits each window
// across one main process plus several `* Helper` processes (renderer, GPU,
// extension host, utility). Match the umbrella app names so usage sampling
// catches all of them.
const EDITOR_PROCESS_PATTERNS: Record<HubConfig["editor"], string[]> = {
	code: ["Visual Studio Code.app/", "Code Helper"],
	cursor: ["Cursor.app/", "Cursor Helper"],
};

export function editorProcessPatterns(editor: HubConfig["editor"]): string[] {
	return EDITOR_PROCESS_PATTERNS[editor] ?? EDITOR_PROCESS_PATTERNS.code;
}

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
