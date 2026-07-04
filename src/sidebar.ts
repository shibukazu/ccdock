import { randomUUID } from "node:crypto";
import { loadConfig } from "./config/config.ts";
import { CURSOR_HIDE, CURSOR_SHOW } from "./tui/ansi.ts";
import {
	closeEditorWindow,
	getFocusedEditorWindow,
	listEditorWindows,
	repositionAllEditors,
	windowMatches,
} from "./workspace/window.ts";
import { disableRawMode, enableRawMode, parseKey, parseKeyWizard } from "./tui/input.ts";
import { matchesFilter } from "./tui/list.ts";
import { renderSidebar } from "./tui/render.ts";
import { renderWizard } from "./tui/wizard.ts";
import type { AgentState, HubConfig, PendingCreation, RepoInfo, SidebarState } from "./types.ts";
import { type WorktreeDiff, getWorktreeDiff } from "./worktree/diff.ts";
import { editorProcessPatterns, focusEditor, openEditor } from "./workspace/editor.ts";
import {
	closeTerminalWindow,
	focusTerminalWindow,
	getFocusedTerminalWindow,
	getSidebarGhosttyWindowId,
	listTerminalWindows,
	openTerminal,
	repositionAllTerminals,
	terminalMatchesWorktree,
} from "./workspace/terminal.ts";
import {
	cleanStaleAgents,
	deleteSession,
	loadAgentStates,
	loadSessions,
	saveSession,
} from "./workspace/state.ts";
import { createWorktree, listWorktrees, removeWorktree } from "./worktree/manager.ts";
import { scanRepos } from "./worktree/scanner.ts";
import { sampleAppUsageByName, sampleProcessUsage } from "./agent/usage.ts";

function sessionNameFromBranch(branchName: string): string {
	const parts = branchName.split("/");
	return parts[parts.length - 1] ?? branchName;
}

function createInitialState(editor: HubConfig["editor"]): SidebarState {
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
		windowCloseConfirm: null,
		windowOpenConfirm: null,
		quitConfirm: null,
		deletingSessionIds: new Set(),
		pendingCreations: [],
		editor,
		editorUsage: null,
		worktreeDiffs: new Map(),
		sidebarWindowId: null,
	};
}

// Working-tree diff cache. Refreshing git diff on every 2s tick is wasteful, so
// results are memoized per worktree and only recomputed when older than this.
const DIFF_TTL_MS = 8000;
const diffCache = new Map<string, { at: number; diff: WorktreeDiff | null }>();

// Sessions whose window is still being opened by createSessionFromPath. The
// session JSON is saved before the window exists, so the refresh loop shows
// these as "launching" instead of flickering to "closed".
const openingSessionIds = new Set<string>();

// Refresh diffs for sessions whose managed window is not closed, honoring the
// per-worktree TTL. Fetches run concurrently. The resulting snapshot is stored
// on state.worktreeDiffs for the renderer to read; the cache itself is
// module-level so it survives the 2s disk-rebuild of the sessions array.
async function refreshWorktreeDiffs(state: SidebarState): Promise<void> {
	const now = Date.now();
	const targets = state.sessions.filter((s) => s.editorState !== "closed");

	const stale = targets.filter((s) => {
		const cached = diffCache.get(s.worktreePath);
		return !cached || now - cached.at >= DIFF_TTL_MS;
	});
	await Promise.all(
		stale.map(async (s) => {
			const diff = await getWorktreeDiff(s.worktreePath);
			diffCache.set(s.worktreePath, { at: Date.now(), diff });
		}),
	);

	// Build the render snapshot from the cache for the currently visible sessions.
	const snapshot = new Map<string, WorktreeDiff | null>();
	for (const s of targets) {
		const cached = diffCache.get(s.worktreePath);
		if (cached) snapshot.set(s.worktreePath, cached.diff);
	}
	state.worktreeDiffs = snapshot;
}

async function refreshSessions(state: SidebarState): Promise<void> {
	const sessions = loadSessions();
	const agentStates = loadAgentStates();

	// Decorate live agents with current CPU% / memory so the TUI can show them.
	const livePids = agentStates
		.filter((a) => a.status === "running" || a.status === "waiting" || a.status === "idle")
		.map((a) => a.pid)
		.filter((p): p is number => typeof p === "number" && p > 0);
	// Skip the system-wide `ps -axo` scan when no editor-kind session has a window
	// open — saves the per-refresh cost on machines with hundreds of processes.
	const needEditorUsage = state.sessions.some(
		(s) => s.kind === "editor" && s.editorState !== "closed",
	);
	const [agentUsage, editorUsage] = await Promise.all([
		livePids.length > 0 ? sampleProcessUsage(livePids) : Promise.resolve(new Map()),
		needEditorUsage
			? sampleAppUsageByName(editorProcessPatterns(state.editor))
			: Promise.resolve(null),
	]);
	if (livePids.length > 0) {
		for (const a of agentStates) {
			const sample = a.pid ? agentUsage.get(a.pid) : undefined;
			if (sample) {
				a.cpuPercent = sample.cpuPercent;
				a.memoryMb = sample.memoryMb;
			} else {
				a.cpuPercent = undefined;
				a.memoryMb = undefined;
			}
		}
	}
	state.editorUsage = editorUsage;

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

	// Detect each session's managed-window state per its kind. The sidebar's own
	// Ghostty window is excluded from the terminal scan so it is never treated as
	// a worktree terminal.
	const excludeId = state.sidebarWindowId;
	// A window may still be launching (open* runs async and refresh fires on a
	// timer). loadSessions() resets editorState to "closed", so carry the previous
	// in-memory "launching" flag forward until the window actually appears.
	const prevLaunching = new Set(
		state.sessions.filter((s) => s.editorState === "launching").map((s) => s.id),
	);
	for (const id of openingSessionIds) prevLaunching.add(id);
	const [editorWindows, focusedEditor, terminalWindows, focusedTerminal] = await Promise.all([
		listEditorWindows(),
		getFocusedEditorWindow(),
		listTerminalWindows(excludeId),
		getFocusedTerminalWindow(excludeId),
	]);

	for (const session of sessions) {
		if (session.kind === "terminal") {
			const hasTerminal = terminalWindows.some((w) =>
				terminalMatchesWorktree(w, session.worktreePath),
			);
			if (
				hasTerminal &&
				focusedTerminal &&
				terminalMatchesWorktree(
					{ id: "", name: "", workingDirectory: focusedTerminal.workingDirectory },
					session.worktreePath,
				)
			) {
				session.editorState = "focused";
			} else if (hasTerminal) {
				session.editorState = "open";
			} else if (prevLaunching.has(session.id)) {
				session.editorState = "launching";
			} else {
				session.editorState = "closed";
			}
		} else {
			const basename = session.worktreePath.split("/").pop() ?? "";
			const hasWindow = editorWindows.some((w) => windowMatches(w, session.worktreePath, basename));
			if (
				hasWindow &&
				focusedEditor.isFrontmost &&
				windowMatches(focusedEditor.frontWindow, session.worktreePath, basename)
			) {
				session.editorState = "focused";
			} else if (hasWindow) {
				session.editorState = "open";
			} else if (prevLaunching.has(session.id)) {
				session.editorState = "launching";
			} else {
				session.editorState = "closed";
			}
		}
	}

	state.sessions = sessions;

	// Keep selectedIndex in bounds
	if (state.selectedIndex >= state.sessions.length) {
		state.selectedIndex = Math.max(0, state.sessions.length - 1);
	}

	// Refresh working-tree diffs (throttled per worktree) for the render snapshot.
	await refreshWorktreeDiffs(state);

	// Update activity log from agents
	for (const agent of agentStates) {
		if (agent.toolName && agent.status === "running") {
			const time = new Date(agent.updatedAt).toLocaleTimeString("en-US", {
				hour12: false,
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			});
			const sessionIdx = state.sessions.findIndex(
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
		? renderWizard(state.wizard, state.cols, state.rows, state.animationFrame)
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
			const filtered = wizard.repos.filter((r) => matchesFilter(r.name, wizard.filter));
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
					wizard.selectedIndex = Math.min(2, wizard.selectedIndex + 1);
					break;
				case "char":
					if (key.char === "j") {
						wizard.selectedIndex = Math.min(2, wizard.selectedIndex + 1);
					} else if (key.char === "k") {
						wizard.selectedIndex = Math.max(0, wizard.selectedIndex - 1);
					}
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
						// Use existing worktree
						const worktrees = await listWorktrees(wizard.repo.path);
						state.wizard = {
							step: "select-worktree",
							repo: wizard.repo,
							worktrees: worktrees,
							selectedIndex: 0,
							repos: wizard.repos,
							filter: "",
						};
					} else if (wizard.selectedIndex === 2) {
						// Open repository root — choose editor vs terminal next.
						state.wizard = {
							step: "select-opener",
							repo: wizard.repo,
							selectedIndex: 0,
							repos: wizard.repos,
							action: { type: "root" },
						};
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
			const filtered = wizard.worktrees.filter(
				(wt) => matchesFilter(wt.branch, wizard.filter) || matchesFilter(wt.path, wizard.filter),
			);
			switch (key.type) {
				case "up":
					wizard.selectedIndex = Math.max(0, wizard.selectedIndex - 1);
					break;
				case "down":
					wizard.selectedIndex = Math.min(
						Math.max(0, filtered.length - 1),
						wizard.selectedIndex + 1,
					);
					break;
				case "enter": {
					const selected = filtered[wizard.selectedIndex];
					if (selected) {
						// Existing worktree — choose editor vs terminal next.
						state.wizard = {
							step: "select-opener",
							repo: wizard.repo,
							selectedIndex: 0,
							repos: wizard.repos,
							action: { type: "existing", path: selected.path, branch: selected.branch },
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
		case "fetch-choice": {
			switch (key.type) {
				case "up":
					wizard.selectedIndex = Math.max(0, wizard.selectedIndex - 1);
					break;
				case "down":
					wizard.selectedIndex = Math.min(1, wizard.selectedIndex + 1);
					break;
				case "char":
					if (key.char === "j") {
						wizard.selectedIndex = Math.min(1, wizard.selectedIndex + 1);
					} else if (key.char === "k") {
						wizard.selectedIndex = Math.max(0, wizard.selectedIndex - 1);
					}
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
						// New worktree — choose editor vs terminal next.
						state.wizard = {
							step: "select-opener",
							repo: wizard.repo,
							selectedIndex: 0,
							repos: wizard.repos,
							action: {
								type: "new-worktree",
								branch: wizard.branchName.trim(),
								fetchBefore: wizard.fetchBeforeCreate,
							},
						};
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
		case "select-opener": {
			switch (key.type) {
				case "up":
					wizard.selectedIndex = Math.max(0, wizard.selectedIndex - 1);
					break;
				case "down":
					wizard.selectedIndex = Math.min(1, wizard.selectedIndex + 1);
					break;
				case "char":
					if (key.char === "j") {
						wizard.selectedIndex = Math.min(1, wizard.selectedIndex + 1);
					} else if (key.char === "k") {
						wizard.selectedIndex = Math.max(0, wizard.selectedIndex - 1);
					}
					break;
				case "enter": {
					const kind = wizard.selectedIndex === 0 ? "editor" : "terminal";
					const repo = wizard.repo;
					const action = wizard.action;
					const editor = config.editor;
					const excludeId = state.sidebarWindowId;
					if (action.type === "root") {
						const message = kind === "editor" ? "Opening editor..." : "Opening terminal...";
						startPendingCreation(state, repo.name, repo.defaultBranch, message, () =>
							createSessionFromPath(repo, repo.path, repo.defaultBranch, editor, kind, excludeId),
						);
					} else if (action.type === "existing") {
						const message = kind === "editor" ? "Opening editor..." : "Opening terminal...";
						startPendingCreation(state, repo.name, action.branch, message, () =>
							createSessionFromPath(repo, action.path, action.branch, editor, kind, excludeId),
						);
					} else {
						const message = action.fetchBefore
							? "Fetching origin..."
							: kind === "editor"
								? "Opening editor..."
								: "Opening terminal...";
						startPendingCreation(state, repo.name, action.branch, message, () =>
							createSession(repo, action.branch, editor, action.fetchBefore, kind, excludeId),
						);
					}
					break;
				}
				case "escape": {
					// Return to the step this opener choice was reached from.
					const action = wizard.action;
					if (action.type === "root") {
						state.wizard = {
							step: "select-mode",
							repo: wizard.repo,
							selectedIndex: 2,
							repos: wizard.repos,
						};
					} else if (action.type === "existing") {
						const worktrees = await listWorktrees(wizard.repo.path);
						state.wizard = {
							step: "select-worktree",
							repo: wizard.repo,
							worktrees,
							selectedIndex: 0,
							repos: wizard.repos,
							filter: "",
						};
					} else {
						state.wizard = {
							step: "enter-branch",
							repo: wizard.repo,
							branchName: action.branch,
							fetchBeforeCreate: action.fetchBefore,
							repos: wizard.repos,
						};
					}
					break;
				}
			}
			break;
		}
	}
}

// Push a "creating" overlay card, drop back to the main screen immediately,
// and run the session-creating operation in the background.
function startPendingCreation(
	state: SidebarState,
	repoName: string,
	branch: string,
	message: string,
	op: () => Promise<void>,
): void {
	const pendingId = randomUUID().slice(0, 8);
	state.pendingCreations.push({
		id: pendingId,
		repoName,
		branch,
		message,
		status: "creating",
		createdAt: Date.now(),
	});
	state.wizard = null;
	render(state);
	void runCreation(state, pendingId, op);
}

async function runCreation(
	state: SidebarState,
	pendingId: string,
	op: () => Promise<void>,
): Promise<void> {
	try {
		await op();
		state.pendingCreations = state.pendingCreations.filter((p) => p.id !== pendingId);
		await refreshSessions(state);
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error";
		const p = state.pendingCreations.find((x) => x.id === pendingId);
		if (p) {
			p.status = "error";
			p.errorMessage = msg;
		}
		state.activityLog.push({
			time: new Date().toLocaleTimeString("en-US", {
				hour12: false,
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			}),
			sessionId: pendingId,
			sessionIndex: -1,
			agent: "ccdock",
			tool: "[error]",
			toolDetail: `session creation failed: ${msg}`,
		});
	}
	render(state);
}

async function createSessionFromPath(
	repo: RepoInfo,
	worktreePath: string,
	branch: string,
	editor: string,
	kind: "editor" | "terminal",
	sidebarWindowId: string | null,
): Promise<void> {
	const sessionName = sessionNameFromBranch(branch);
	const session = {
		id: randomUUID().slice(0, 8),
		sessionName: `${repo.name}:${sessionName}`,
		worktreePath,
		branch,
		repoName: repo.name,
		kind,
		agents: [],
		editorState: "open" as const,
		createdAt: Date.now(),
		lastActiveAt: Date.now(),
	};
	saveSession(session);
	openingSessionIds.add(session.id);
	try {
		if (kind === "terminal") {
			await openTerminal(worktreePath, sidebarWindowId);
		} else {
			await openEditor(worktreePath, editor);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error";
		const what = kind === "terminal" ? "terminal" : "editor";
		process.stderr.write(`\nError opening ${what}: ${msg}\n`);
	} finally {
		openingSessionIds.delete(session.id);
	}
}

async function createSession(
	repo: RepoInfo,
	branchName: string,
	editor: string,
	fetchBeforeCreate: boolean,
	kind: "editor" | "terminal",
	sidebarWindowId: string | null,
): Promise<void> {
	const worktreePath = await createWorktree(repo.path, branchName, {
		fetch: fetchBeforeCreate,
		base: repo.defaultBranch,
	});
	await createSessionFromPath(repo, worktreePath, branchName, editor, kind, sidebarWindowId);
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
			const excludeId = state.sidebarWindowId;
			const kind = state.sessions.find((s) => s.id === sessionId)?.kind ?? "editor";
			// Close the confirm modal immediately and mark the card as deleting
			state.deleteConfirm = null;
			state.deletingSessionIds.add(sessionId);
			render(state);

			// Perform the actual deletion asynchronously so the spinner stays responsive
			void (async () => {
				try {
					if (kind === "terminal") {
						await closeTerminalWindow(worktreePath, excludeId);
					} else {
						await closeEditorWindow(worktreePath);
					}
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

async function handleWindowCloseConfirmInput(state: SidebarState, data: Buffer): Promise<void> {
	const confirm = state.windowCloseConfirm;
	if (!confirm) return;

	const key = parseKeyWizard(data);

	switch (key.type) {
		case "enter": {
			const { worktreePath, target } = confirm;
			const excludeId = state.sidebarWindowId;
			state.windowCloseConfirm = null;
			render(state);

			void (async () => {
				if (target === "terminal") {
					await closeTerminalWindow(worktreePath, excludeId);
				} else {
					await closeEditorWindow(worktreePath);
				}
				await refreshSessions(state);
				render(state);
			})();
			break;
		}
		case "escape":
			state.windowCloseConfirm = null;
			break;
	}
}

async function handleWindowOpenConfirmInput(state: SidebarState, data: Buffer): Promise<void> {
	const confirm = state.windowOpenConfirm;
	if (!confirm) return;

	const key = parseKeyWizard(data);

	switch (key.type) {
		case "enter": {
			const { sessionId, worktreePath, kind } = confirm;
			state.windowOpenConfirm = null;
			render(state);

			void (async () => {
				const focused =
					kind === "terminal"
						? await focusTerminalWindow(worktreePath, state.sidebarWindowId)
						: await focusEditor(worktreePath, state.editor, state.sidebarWindowId);
				if (!focused) {
					const session = state.sessions.find((s) => s.id === sessionId);
					if (session) {
						session.editorState = "launching";
						render(state);
					}
					if (kind === "terminal") {
						await openTerminal(worktreePath, state.sidebarWindowId);
					} else {
						await openEditor(worktreePath, state.editor, state.sidebarWindowId);
					}
					if (session) session.editorState = "open";
				}
				render(state);
			})();
			break;
		}
		case "escape":
			state.windowOpenConfirm = null;
			break;
	}
}

function getManagedWindows(sessions: SidebarState["sessions"]): { worktreePath: string }[] {
	return sessions
		.filter((s) => s.kind === "editor" && s.editorState !== "closed")
		.map((s) => ({ worktreePath: s.worktreePath }));
}

function getManagedTerminals(sessions: SidebarState["sessions"]): { worktreePath: string }[] {
	return sessions
		.filter((s) => s.kind === "terminal" && s.editorState !== "closed")
		.map((s) => ({ worktreePath: s.worktreePath }));
}

export async function runSidebar(): Promise<void> {
	const config = loadConfig();
	const state = createInitialState(config.editor);

	// Tag our own terminal with a unique title, then resolve the sidebar's
	// Ghostty window id from it. Every terminal list/close/reposition/focus
	// operation excludes this id so the sidebar never closes or moves itself.
	// Title-based lookup stays correct even when ccdock is restarted while a
	// worktree terminal is frontmost (front-window guessing does not).
	const sidebarTitle = `ccdock [${process.pid}]`;
	process.stdout.write(`\x1b]2;${sidebarTitle}\x07`);
	await Bun.sleep(250);
	state.sidebarWindowId = await getSidebarGhosttyWindowId(sidebarTitle);

	// Initial load
	await refreshSessions(state);
	cleanStaleAgents();

	// Enable raw mode for keyboard input
	enableRawMode();
	process.stdout.write(CURSOR_HIDE);

	// Handle terminal resize — also reposition VS Code + Ghostty windows
	process.stdout.on("resize", async () => {
		state.rows = process.stdout.rows ?? 24;
		state.cols = process.stdout.columns ?? 80;
		render(state);
		await Promise.all([
			repositionAllEditors(getManagedWindows(state.sessions), state.sidebarWindowId),
			repositionAllTerminals(getManagedTerminals(state.sessions), state.sidebarWindowId),
		]);
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
			state.windowCloseConfirm ||
			state.windowOpenConfirm ||
			state.quitConfirm ||
			state.deletingSessionIds.size > 0 ||
			state.pendingCreations.length > 0
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
						// Close the managed window (editor or terminal) for every session.
						for (const session of state.sessions) {
							if (session.kind === "terminal") {
								await closeTerminalWindow(session.worktreePath, state.sidebarWindowId);
							} else {
								await closeEditorWindow(session.worktreePath);
							}
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

		// Window close confirmation mode
		if (state.windowCloseConfirm) {
			await handleWindowCloseConfirmInput(state, data);
			render(state);
			return;
		}

		// Window open confirmation mode
		if (state.windowOpenConfirm) {
			await handleWindowOpenConfirmInput(state, data);
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
					const focused =
						session.kind === "terminal"
							? await focusTerminalWindow(session.worktreePath, state.sidebarWindowId)
							: await focusEditor(session.worktreePath, config.editor, state.sidebarWindowId);
					if (!focused) {
						// Show launching state while the window opens.
						session.editorState = "launching";
						render(state);
						if (session.kind === "terminal") {
							await openTerminal(session.worktreePath, state.sidebarWindowId);
						} else {
							await openEditor(session.worktreePath, config.editor, state.sidebarWindowId);
						}
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
				const errorPending = state.pendingCreations.find((p) => p.status === "error");
				if (errorPending) {
					state.pendingCreations = state.pendingCreations.filter((p) => p.id !== errorPending.id);
					break;
				}
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
				await Promise.all([
					repositionAllEditors(getManagedWindows(state.sessions), state.sidebarWindowId),
					repositionAllTerminals(getManagedTerminals(state.sessions), state.sidebarWindowId),
				]);
				break;

			case "window_close": {
				const session = state.sessions[state.selectedIndex];
				if (
					session &&
					!state.deletingSessionIds.has(session.id) &&
					session.editorState !== "closed"
				) {
					state.windowCloseConfirm = {
						sessionId: session.id,
						worktreePath: session.worktreePath,
						target: session.kind,
					};
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
						const isOpen =
							session.editorState === "open" ||
							session.editorState === "focused" ||
							session.editorState === "launching";
						if (isOpen) {
							// Window is believed open: focus it directly, no confirm.
							const focused =
								session.kind === "terminal"
									? await focusTerminalWindow(session.worktreePath, state.sidebarWindowId)
									: await focusEditor(session.worktreePath, config.editor, state.sidebarWindowId);
							// If focus failed the window actually vanished — fall back to the
							// open confirmation instead of silently launching a new one.
							if (!focused) {
								state.windowOpenConfirm = {
									sessionId: session.id,
									worktreePath: session.worktreePath,
									kind: session.kind,
								};
							}
						} else {
							// Window is closed: clicks are easy to fire by accident, so
							// confirm before opening (Enter stays direct).
							state.windowOpenConfirm = {
								sessionId: session.id,
								worktreePath: session.worktreePath,
								kind: session.kind,
							};
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
