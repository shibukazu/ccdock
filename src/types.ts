export type AgentType = "claude-code" | "codex";
export type AgentStatus = "running" | "waiting" | "idle" | "error" | "unknown";

export interface AgentState {
	sessionId: string;
	agentType: AgentType;
	status: AgentStatus;
	prompt: string;
	toolName: string;
	toolDetail: string; // human-readable detail from tool_input
	cwd: string;
	updatedAt: number; // Date.now()
}

export type EditorState = "focused" | "open" | "closed" | "launching";

export interface WorkspaceSession {
	id: string; // unique session ID (uuid or short hash)
	sessionName: string; // display name
	worktreePath: string;
	branch: string;
	repoName: string; // extracted from path
	agents: AgentState[]; // populated from state files
	editorState: EditorState; // VS Code window state
	createdAt: number;
	lastActiveAt: number;
}

export interface RepoInfo {
	name: string;
	path: string;
	defaultBranch: string;
}

export interface WorktreeEntry {
	path: string;
	branch: string;
}

export interface DeleteConfirm {
	sessionId: string;
	worktreePath: string;
	selectedIndex: number; // 0 = session only, 1 = session + worktree
}

export interface SidebarState {
	sessions: WorkspaceSession[];
	selectedIndex: number;
	rows: number;
	cols: number;
	animationFrame: number;
	compactMode: boolean;
	showActivityLog: boolean;
	cardRowRanges: Array<{ sessionIndex: number; startRow: number; endRow: number }>;
	activityLog: Array<{
		time: string;
		sessionId: string;
		sessionIndex: number;
		agent: string;
		tool: string;
		toolDetail: string;
	}>;
	wizard: WizardState;
	deleteConfirm: DeleteConfirm | null;
	quitConfirm: { selectedIndex: number } | null; // 0=quit only, 1=quit+close editors
}

// Wizard steps for creating new sessions
export type WizardStep =
	| { step: "select-repo"; repos: RepoInfo[]; selectedIndex: number; filter: string }
	| { step: "select-mode"; repo: RepoInfo; selectedIndex: number; repos: RepoInfo[] }
	| {
			step: "select-worktree";
			repo: RepoInfo;
			worktrees: WorktreeEntry[];
			selectedIndex: number;
			repos: RepoInfo[];
	  }
	| { step: "enter-branch"; repo: RepoInfo; branchName: string; repos: RepoInfo[] };

export type WizardState = WizardStep | null;

export interface HubConfig {
	workspace_dirs: string[];
	editor: "code" | "cursor";
}
