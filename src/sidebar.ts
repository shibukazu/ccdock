import { randomUUID } from "node:crypto";
import { loadConfig } from "./config/config.ts";
import { CURSOR_HIDE, CURSOR_SHOW } from "./tui/ansi.ts";
import {
	repositionAllEditors,
	closeAllEditors,
	closeEditorWindow,
	listEditorWindows,
	getFocusedEditorWindow,
	windowMatchesSession,
} from "./workspace/window.ts";
import { disableRawMode, enableRawMode, parseKey, parseKeyWizard } from "./tui/input.ts";
import { renderSidebar } from "./tui/render.ts";
import { renderWizard } from "./tui/wizard.ts";
import type { AgentState, RepoInfo, SidebarState } from "./types.ts";
import { focusEditor, openEditor } from "./workspace/editor.ts";
import {
	cleanStaleAgents,
	deleteSession,
	loadAgentStates,
	loadSessions,
	saveSession,
} from "./workspace/state.ts";
import {
	createWorktree,
	createWorktreeFromRemote,
	listWorktrees,
	removeWorktree,
} from "./worktree/manager.ts";
import { listRemoteBranches } from "./worktree/remote.ts";
import { scanRepos } from "./worktree/scanner.ts";
import { sampleProcessUsage } from "./agent/usage.ts";
import { writeWindowTitleMarker } from "./workspace/marker.ts";

function sessionNameFromBranch(branchName: string): string {
	const parts = branchName.split("/");
	return parts[parts.length - 1] ?? branchName;
}

function createInitialState(): SidebarState {
	const [rows, cols] = [process.stdout.rows ?? 24, process.stdout.columns ?? 80];
	return {
		sessions: [],
		selectedIndex: 0,
		rows,
		cols,
		animationFrame: 0,
		compactMode: false,
		showActivityLog: false,
		cardRowRanges: [],
		activityLog: [],
		wizard: null,
		deleteConfirm: null,
		quitConfirm: null,
		deletingSessionIds: new Set(),
	};
}

async function refreshSessions(state: SidebarState): Promise<void> {
	const sessions = loadSessions();
	const agentStates = loadAgentStates();

	// Decorate live agents with current CPU% / memory so the TUI can show them.
	const livePids = agentStates
		.filter((a) => a.status === "running" || a.status === "waiting" || a.status === "idle")
		.map((a) => a.pid)
		.filter((p): p is number => typeof p === "number" && p > 0);
	if (livePids.length > 0) {
		const usage = await sampleProcessUsage(livePids);
		for (const a of agentStates) {
			const sample = a.pid ? usage.get(a.pid) : undefined;
			if (sample) {
				a.cpuPercent = sample.cpuPercent;
				a.memoryMb = sample.memoryMb;
			} else {
				a.cpuPercent = undefined;
				a.memoryMb = undefined;
			}
		}
	}

	// Match agent states to sessions by cwd prefix.
	// Sort sessions by worktreePath length descending so that more specific
	// paths (e.g. /repo/.wt/fix/foo) are matched before shorter prefixes
	// (e.g. /repo), preventing worktree agents from also appearing under the
	// main-branch session.
	const sessionsByPathLen = [...sessions].sort(
		(a, b) => b.worktreePath.length - a.worktreePath.length,
	);
	const assignedAgents = new Set<AgentState>();
	for (const session of sessionsByPathLen) {
		session.agents = agentStates.filter((a) => {
			if (assignedAgents.has(a)) return false;
			return (
				a.sessionId === session.id ||
				a.cwd.startsWith(`${session.worktreePath}/`) ||
				a.cwd === session.worktreePath
			);
		});
		for (const a of session.agents) {
			assignedAgents.add(a);
		}
	}

	// Detect editor window state for each session
	const [editorWindows, focusedEditor] = await Promise.all([
		listEditorWindows(),
		getFocusedEditorWindow(),
	]);

	for (const session of sessions) {
		const basename = session.worktreePath.split("/").pop() ?? "";
		const hasWindow = editorWindows.some((w) => windowMatchesSession(w, basename, session.id));
		if (
			hasWindow &&
			focusedEditor.isFrontmost &&
			windowMatchesSession(focusedEditor.frontWindow, basename, session.id)
		) {
			session.editorState = "focused";
		} else if (hasWindow) {
			session.editorState = "open";
		} else {
			session.editorState = "closed";
		}
	}

	state.sessions = sessions;

	// Keep selectedIndex in bounds
	if (state.selectedIndex >= state.sessions.length) {
		state.selectedIndex = Math.max(0, state.sessions.length - 1);
	}

	// Update activity log from agents
	for (const agent of agentStates) {
		if (agent.toolName && agent.status === "running") {
			const time = new Date(agent.updatedAt).toLocaleTimeString("en-US", {
				hour12: false,
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			});
			const sessionIdx = sessions.findIndex(
				(s) =>
					agent.sessionId === s.id ||
					agent.cwd === s.worktreePath ||
					agent.cwd.startsWith(`${s.worktreePath}/`),
			);
			// Only add if not duplicate of last entry
			const lastEntry = state.activityLog[state.activityLog.length - 1];
			const toolKey = `${agent.toolName}:${agent.toolDetail}`;
			if (!lastEntry || lastEntry.time !== time || lastEntry.tool !== toolKey) {
				state.activityLog.push({
					time,
					sessionId: agent.sessionId,
					sessionIndex: sessionIdx,
					agent: agent.agentType,
					tool: agent.toolName,
					toolDetail: agent.toolDetail,
				});
				// Keep log to last 50 entries
				if (state.activityLog.length > 50) {
					state.activityLog = state.activityLog.slice(-50);
				}
			}
		}
	}
}

let lastRendered = "";

function render(state: SidebarState): void {
	const output = state.wizard
		? renderWizard(state.wizard, state.cols, state.animationFrame)
		: renderSidebar(state);
	if (output === lastRendered) return;
	lastRendered = output;
	process.stdout.write(output);
}

async function handleWizardInput(
	state: SidebarState,
	data: Buffer,
	config: { editor: string },
): Promise<void> {
	const wizard = state.wizard;
	if (!wizard) return;

	const key = parseKeyWizard(data);

	switch (wizard.step) {
		case "select-repo": {
			const filtered = wizard.repos.filter((r) =>
				r.name.toLowerCase().includes(wizard.filter.toLowerCase()),
			);
			switch (key.type) {
				case "up":
					wizard.selectedIndex = Math.max(0, wizard.selectedIndex - 1);
					break;
				case "down":
					wizard.selectedIndex = Math.min(filtered.length - 1, wizard.selectedIndex + 1);
					break;
				case "enter": {
					const selected = filtered[wizard.selectedIndex];
					if (selected) {
						state.wizard = {
							step: "select-mode",
							repo: selected,
							selectedIndex: 0,
							repos: wizard.repos,
						};
					}
					break;
				}
				case "escape":
					state.wizard = null;
					break;
				case "backspace":
					wizard.filter = wizard.filter.slice(0, -1);
					wizard.selectedIndex = 0;
					break;
				case "char":
					wizard.filter += key.char;
					wizard.selectedIndex = 0;
					break;
			}
			break;
		}
		case "select-mode": {
			switch (key.type) {
				case "up":
					wizard.selectedIndex = Math.max(0, wizard.selectedIndex - 1);
					break;
				case "down":
					wizard.selectedIndex = Math.min(3, wizard.selectedIndex + 1);
					break;
				case "enter":
					if (wizard.selectedIndex === 0) {
						// Create new worktree (git wt) — ask about fetch first
						state.wizard = {
							step: "fetch-choice",
							repo: wizard.repo,
							selectedIndex: 0,
							repos: wizard.repos,
						};
					} else if (wizard.selectedIndex === 1) {
						// From remote branch — fetch and show remote branches
						const branches = await listRemoteBranches(wizard.repo.path);
						state.wizard = {
							step: "select-remote-branch",
							repo: wizard.repo,
							branches,
							selectedIndex: 0,
							filter: "",
							repos: wizard.repos,
						};
					} else if (wizard.selectedIndex === 2) {
						// Use existing worktree
						const worktrees = await listWorktrees(wizard.repo.path);
						state.wizard = {
							step: "select-worktree",
							repo: wizard.repo,
							worktrees: worktrees,
							selectedIndex: 0,
							repos: wizard.repos,
						};
					} else if (wizard.selectedIndex === 3) {
						// Open repository root
						const repo = wizard.repo;
						state.wizard = {
							step: "creating",
							repo,
							message: "Opening repository...",
						};
						render(state);
						void (async () => {
							await createSessionFromPath(repo, repo.path, repo.defaultBranch, config.editor);
							state.wizard = null;
							await refreshSessions(state);
							render(state);
						})();
					}
					break;
				case "escape":
					state.wizard = {
						step: "select-repo",
						repos: wizard.repos,
						selectedIndex: 0,
						filter: "",
					};
					break;
			}
			break;
		}
		case "select-worktree": {
			switch (key.type) {
				case "up":
					wizard.selectedIndex = Math.max(0, wizard.selectedIndex - 1);
					break;
				case "down":
					wizard.selectedIndex = Math.min(wizard.worktrees.length - 1, wizard.selectedIndex + 1);
					break;
				case "enter": {
					const selected = wizard.worktrees[wizard.selectedIndex];
					if (selected) {
						const repo = wizard.repo;
						state.wizard = {
							step: "creating",
							repo,
							message: "Opening worktree...",
						};
						render(state);
						void (async () => {
							await createSessionFromPath(repo, selected.path, selected.branch, config.editor);
							state.wizard = null;
							await refreshSessions(state);
							render(state);
						})();
					}
					break;
				}
				case "escape":
					state.wizard = {
						step: "select-mode",
						repo: wizard.repo,
						selectedIndex: 2,
						repos: wizard.repos,
					};
					break;
			}
			break;
		}
		case "fetch-choice": {
			switch (key.type) {
				case "up":
					wizard.selectedIndex = Math.max(0, wizard.selectedIndex - 1);
					break;
				case "down":
					wizard.selectedIndex = Math.min(1, wizard.selectedIndex + 1);
					break;
				case "enter":
					state.wizard = {
						step: "enter-branch",
						repo: wizard.repo,
						branchName: "",
						fetchBeforeCreate: wizard.selectedIndex === 0,
						repos: wizard.repos,
					};
					break;
				case "escape":
					state.wizard = {
						step: "select-mode",
						repo: wizard.repo,
						selectedIndex: 0,
						repos: wizard.repos,
					};
					break;
			}
			break;
		}
		case "enter-branch": {
			switch (key.type) {
				case "enter": {
					if (wizard.branchName.trim()) {
						const repo = wizard.repo;
						const branch = wizard.branchName.trim();
						const fetchBefore = wizard.fetchBeforeCreate;
						state.wizard = {
							step: "creating",
							repo,
							message: "Creating worktree...",
						};
						render(state);
						void (async () => {
							await createSession(repo, branch, config.editor, fetchBefore);
							state.wizard = null;
							await refreshSessions(state);
							render(state);
						})();
					}
					break;
				}
				case "escape":
					state.wizard = {
						step: "fetch-choice",
						repo: wizard.repo,
						selectedIndex: wizard.fetchBeforeCreate ? 0 : 1,
						repos: wizard.repos,
					};
					break;
				case "backspace":
					wizard.branchName = wizard.branchName.slice(0, -1);
					break;
				case "char":
					wizard.branchName += key.char;
					break;
			}
			break;
		}
		case "select-remote-branch": {
			const filteredBranches = wizard.branches.filter((b) =>
				b.toLowerCase().includes(wizard.filter.toLowerCase()),
			);
			switch (key.type) {
				case "up":
					wizard.selectedIndex = Math.max(0, wizard.selectedIndex - 1);
					break;
				case "down":
					wizard.selectedIndex = Math.min(
						Math.max(0, filteredBranches.length - 1),
						wizard.selectedIndex + 1,
					);
					break;
				case "enter": {
					const selected = filteredBranches[wizard.selectedIndex];
					if (selected) {
						state.wizard = {
							step: "enter-local-branch",
							repo: wizard.repo,
							remoteRef: selected,
							localBranch: selected.replace(/^origin\//, ""),
							repos: wizard.repos,
						};
					}
					break;
				}
				case "escape":
					state.wizard = {
						step: "select-mode",
						repo: wizard.repo,
						selectedIndex: 1,
						repos: wizard.repos,
					};
					break;
				case "backspace":
					wizard.filter = wizard.filter.slice(0, -1);
					wizard.selectedIndex = 0;
					break;
				case "char":
					wizard.filter += key.char;
					wizard.selectedIndex = 0;
					break;
			}
			break;
		}
		case "enter-local-branch": {
			switch (key.type) {
				case "enter": {
					if (wizard.localBranch.trim()) {
						const repo = wizard.repo;
						const localBranch = wizard.localBranch.trim();
						const remoteRef = wizard.remoteRef;
						state.wizard = {
							step: "creating",
							repo,
							message: "Creating worktree from remote...",
						};
						render(state);
						void (async () => {
							await createSessionFromRemote(repo, localBranch, remoteRef, config.editor);
							state.wizard = null;
							await refreshSessions(state);
							render(state);
						})();
					}
					break;
				}
				case "escape":
					state.wizard = {
						step: "select-remote-branch",
						repo: wizard.repo,
						branches: [],
						selectedIndex: 0,
						filter: "",
						repos: wizard.repos,
					};
					// re-fetch branches lazily — simpler to re-run the list now
					state.wizard.branches = await listRemoteBranches(wizard.repo.path);
					break;
				case "backspace":
					wizard.localBranch = wizard.localBranch.slice(0, -1);
					break;
				case "char":
					wizard.localBranch += key.char;
					break;
			}
			break;
		}
		case "creating":
			// Ignore all input while creating — operation is in progress
			break;
	}
}

async function createSessionFromPath(
	repo: RepoInfo,
	worktreePath: string,
	branch: string,
	editor: string,
): Promise<void> {
	try {
		const sessionName = sessionNameFromBranch(branch);
		const session = {
			id: randomUUID().slice(0, 8),
			sessionName: `${repo.name}:${sessionName}`,
			worktreePath,
			branch,
			repoName: repo.name,
			agents: [],
			editorState: "open" as const,
			createdAt: Date.now(),
			lastActiveAt: Date.now(),
		};
		saveSession(session);
		// Stamp a unique token into VS Code's window.title so that two sessions
		// sharing the same branch basename across repos do not collide on focus.
		writeWindowTitleMarker(worktreePath, session.id);
		await openEditor(worktreePath, editor, session.id);
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error";
		process.stderr.write(`\nError creating session: ${msg}\n`);
	}
}

async function createSession(
	repo: RepoInfo,
	branchName: string,
	editor: string,
	fetchBeforeCreate: boolean,
): Promise<void> {
	try {
		const worktreePath = await createWorktree(repo.path, branchName, {
			fetch: fetchBeforeCreate,
			base: repo.defaultBranch,
		});
		await createSessionFromPath(repo, worktreePath, branchName, editor);
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error";
		process.stderr.write(`\nError creating session: ${msg}\n`);
	}
}

async function createSessionFromRemote(
	repo: RepoInfo,
	localBranch: string,
	remoteRef: string,
	editor: string,
): Promise<void> {
	try {
		const worktreePath = await createWorktreeFromRemote(repo.path, localBranch, remoteRef);
		await createSessionFromPath(repo, worktreePath, localBranch, editor);
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error";
		process.stderr.write(`\nError creating session from remote: ${msg}\n`);
	}
}

async function handleDeleteConfirmInput(state: SidebarState, data: Buffer): Promise<void> {
	const confirm = state.deleteConfirm;
	if (!confirm) return;

	const key = parseKeyWizard(data);

	switch (key.type) {
		case "up":
			confirm.selectedIndex = Math.max(0, confirm.selectedIndex - 1);
			break;
		case "down":
			confirm.selectedIndex = Math.min(1, confirm.selectedIndex + 1);
			break;
		case "enter": {
			const { sessionId, worktreePath, selectedIndex } = confirm;
			const removeWorktreeToo = selectedIndex === 1;
			// Close the confirm modal immediately and mark the card as deleting
			state.deleteConfirm = null;
			state.deletingSessionIds.add(sessionId);
			render(state);

			// Perform the actual deletion asynchronously so the spinner stays responsive
			void (async () => {
				try {
					const basename = worktreePath.split("/").pop() ?? "";
					await closeEditorWindow(basename, sessionId);
					deleteSession(sessionId);

					if (removeWorktreeToo) {
						try {
							await removeWorktree(worktreePath);
						} catch (err) {
							const msg = err instanceof Error ? err.message : "Unknown error";
							state.activityLog.push({
								time: new Date().toLocaleTimeString("en-US", {
									hour12: false,
									hour: "2-digit",
									minute: "2-digit",
									second: "2-digit",
								}),
								sessionId,
								sessionIndex: -1,
								agent: "ccdock",
								tool: "[error]",
								toolDetail: `worktree remove failed: ${msg}`,
							});
						}
					}
				} finally {
					state.deletingSessionIds.delete(sessionId);
					await refreshSessions(state);
					render(state);
				}
			})();
			break;
		}
		case "escape":
			state.deleteConfirm = null;
			break;
	}
}

function getManagedWindows(
	sessions: SidebarState["sessions"],
): { basename: string; sessionId: string | null }[] {
	return sessions
		.filter((s) => s.editorState !== "closed")
		.map((s) => ({
			basename: s.worktreePath.split("/").pop() ?? "",
			sessionId: s.id,
		}))
		.filter((m) => m.basename.length > 0);
}

export async function runSidebar(): Promise<void> {
	const config = loadConfig();
	const state = createInitialState();

	// Initial load
	await refreshSessions(state);
	cleanStaleAgents();

	// Enable raw mode for keyboard input
	enableRawMode();
	process.stdout.write(CURSOR_HIDE);

	// Handle terminal resize — also reposition VS Code windows
	process.stdout.on("resize", async () => {
		state.rows = process.stdout.rows ?? 24;
		state.cols = process.stdout.columns ?? 80;
		render(state);
		await repositionAllEditors(getManagedWindows(state.sessions));
	});

	// Animation timer (200ms) — only repaint when there's something animating
	const animTimer = setInterval(() => {
		state.animationFrame++;
		const hasAnimated = state.sessions.some(
			(s) =>
				s.editorState === "launching" ||
				s.agents.some((a) => a.status === "running" || a.status === "waiting"),
		);
		if (
			hasAnimated ||
			state.wizard ||
			state.deleteConfirm ||
			state.quitConfirm ||
			state.deletingSessionIds.size > 0
		) {
			render(state);
		}
	}, 200);

	// Refresh timer (2s) - reload state files, agent states, editor states
	const refreshTimer = setInterval(async () => {
		cleanStaleAgents();
		await refreshSessions(state);
		render(state);
	}, 2000);

	// Initial render
	render(state);

	// Handle keyboard input
	const cleanup = () => {
		clearInterval(animTimer);
		clearInterval(refreshTimer);
		process.stdout.write(CURSOR_SHOW);
		disableRawMode();
	};

	process.stdin.on("data", async (data: Buffer) => {
		// Quit confirmation mode
		if (state.quitConfirm) {
			const key = parseKeyWizard(data);
			switch (key.type) {
				case "up":
					state.quitConfirm.selectedIndex = Math.max(0, state.quitConfirm.selectedIndex - 1);
					break;
				case "down":
					state.quitConfirm.selectedIndex = Math.min(1, state.quitConfirm.selectedIndex + 1);
					break;
				case "enter":
					if (state.quitConfirm.selectedIndex === 1) {
						// Close VS Code windows for all managed sessions
						for (const session of state.sessions) {
							const basename = session.worktreePath.split("/").pop() ?? "";
							await closeEditorWindow(basename, session.id);
						}
					}
					cleanup();
					process.exit(0);
					break;
				case "escape":
					state.quitConfirm = null;
					break;
			}
			render(state);
			return;
		}

		// Delete confirmation mode
		if (state.deleteConfirm) {
			await handleDeleteConfirmInput(state, data);
			render(state);
			return;
		}

		// Wizard mode
		if (state.wizard) {
			await handleWizardInput(state, data, { editor: config.editor });
			render(state);
			return;
		}

		const key = parseKey(data);

		switch (key.type) {
			case "quit":
				state.quitConfirm = { selectedIndex: 0 };
				break;

			case "up":
				state.selectedIndex = Math.max(0, state.selectedIndex - 1);
				break;

			case "down":
				state.selectedIndex = Math.min(state.sessions.length - 1, state.selectedIndex + 1);
				break;

			case "enter":
			case "tab": {
				const session = state.sessions[state.selectedIndex];
				if (session && !state.deletingSessionIds.has(session.id)) {
					const focused = await focusEditor(session.worktreePath, config.editor, session.id);
					if (!focused) {
						// Show launching state while VS Code opens
						session.editorState = "launching";
						render(state);
						await openEditor(session.worktreePath, config.editor, session.id);
						session.editorState = "open";
					}
				}
				break;
			}

			case "new": {
				const repos = await scanRepos(config.workspace_dirs);
				state.wizard = {
					step: "select-repo",
					repos,
					selectedIndex: 0,
					filter: "",
				};
				break;
			}

			case "delete": {
				const session = state.sessions[state.selectedIndex];
				if (session && !state.deletingSessionIds.has(session.id)) {
					state.deleteConfirm = {
						sessionId: session.id,
						worktreePath: session.worktreePath,
						selectedIndex: 0,
					};
				}
				break;
			}

			case "compact":
				state.compactMode = !state.compactMode;
				break;

			case "log":
				state.showActivityLog = !state.showActivityLog;
				break;

			case "realign":
				await repositionAllEditors(getManagedWindows(state.sessions));
				break;

			case "window_close": {
				const session = state.sessions[state.selectedIndex];
				if (session && !state.deletingSessionIds.has(session.id)) {
					const basename = session.worktreePath.split("/").pop() ?? "";
					await closeEditorWindow(basename, session.id);
				}
				break;
			}

			case "mouse_click": {
				const clicked = state.cardRowRanges.find(
					(r) => key.row >= r.startRow && key.row <= r.endRow,
				);
				if (clicked) {
					state.selectedIndex = clicked.sessionIndex;
					const session = state.sessions[clicked.sessionIndex];
					if (session && !state.deletingSessionIds.has(session.id)) {
						const focused = await focusEditor(session.worktreePath, config.editor, session.id);
						if (!focused) {
							session.editorState = "launching";
							render(state);
							await openEditor(session.worktreePath, config.editor, session.id);
							session.editorState = "open";
						}
					}
				}
				break;
			}
		}

		render(state);
	});

	// Handle process signals
	process.on("SIGINT", () => {
		cleanup();
		process.exit(0);
	});

	process.on("SIGTERM", () => {
		cleanup();
		process.exit(0);
	});
}
