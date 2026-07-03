import type { RepoInfo, WizardState, WorktreeEntry } from "../types.ts";
import { BOLD, BOX, CLEAR_SCREEN, COLORS, CURSOR_HOME, DIM, RESET, truncate } from "./ansi.ts";
import { computeListWindow, matchesFilter } from "./list.ts";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function renderRepoList(
	repos: RepoInfo[],
	selectedIndex: number,
	filter: string,
	cols: number,
	rows: number,
): string[] {
	const lines: string[] = [];
	const width = Math.max(cols - 4, 20);

	lines.push(`${BOLD}${COLORS.highlight} Select Repository${RESET}`);
	lines.push("");

	if (filter) {
		lines.push(`${COLORS.muted}  Filter: ${RESET}${filter}`);
		lines.push("");
	}

	const filtered = repos.filter((r) => matchesFilter(r.name, filter));

	if (filtered.length === 0) {
		lines.push(`${DIM}  No repos matching "${filter}"${RESET}`);
	} else {
		// Fixed lines already pushed (title, blank, optional filter+blank) plus the 2 footer lines below.
		// When the list overflows, reserve rows for both indicators up front so the
		// output never exceeds the terminal height.
		const fixedLinesUsed = lines.length + 2;
		const baseMaxVisible = Math.max(1, rows - fixedLinesUsed);
		const maxVisible =
			filtered.length > baseMaxVisible ? Math.max(1, baseMaxVisible - 2) : baseMaxVisible;
		const window = computeListWindow(filtered.length, selectedIndex, maxVisible);

		if (window.start > 0) {
			lines.push(`${DIM}  ↑ ${window.start} more${RESET}`);
		}

		for (let i = window.start; i < window.end; i++) {
			const repo = filtered[i];
			if (!repo) continue;
			const isSelected = i === selectedIndex;
			const marker = isSelected ? `${COLORS.highlight}\u25b6${RESET}` : " ";
			const name = isSelected
				? `${BOLD}${COLORS.title}${repo.name}${RESET}`
				: `${COLORS.subtitle}${repo.name}${RESET}`;
			const branch = `${COLORS.muted}(${repo.defaultBranch})${RESET}`;
			const line = ` ${marker} ${name} ${branch}`;
			lines.push(truncate(line, width));
		}

		if (window.end < filtered.length) {
			lines.push(`${DIM}  ↓ ${filtered.length - window.end} more${RESET}`);
		}
	}

	lines.push("");
	lines.push(`${COLORS.muted}  ↑/↓: navigate | Enter: select | Esc: cancel${RESET}`);
	lines.push(`${COLORS.muted}  Type to filter repos${RESET}`);

	return lines;
}

function renderModeSelect(repo: RepoInfo, selectedIndex: number, cols: number): string[] {
	const lines: string[] = [];
	const width = Math.max(cols - 4, 20);

	lines.push(`${BOLD}${COLORS.highlight} Create Session: ${repo.name}${RESET}`);
	lines.push("");
	lines.push(`${COLORS.muted}  Select mode:${RESET}`);
	lines.push("");

	const modes = [
		{ label: "Create new worktree (git wt)", desc: "Create a new feature branch worktree" },
		{ label: "Use existing worktree", desc: "Select from existing worktrees" },
		{ label: "Open repository root", desc: "Open the main repository directory" },
	];

	for (let i = 0; i < modes.length; i++) {
		const mode = modes[i];
		if (!mode) continue;
		const isSelected = i === selectedIndex;
		const marker = isSelected ? `${COLORS.highlight}\u25b6${RESET}` : " ";
		const label = isSelected
			? `${BOLD}${COLORS.title}${mode.label}${RESET}`
			: `${COLORS.subtitle}${mode.label}${RESET}`;
		const desc = `${COLORS.muted}${mode.desc}${RESET}`;
		lines.push(truncate(` ${marker} ${label}`, width));
		lines.push(truncate(`     ${desc}`, width));
	}

	lines.push("");
	lines.push(`${COLORS.muted}  j/k: navigate | Enter: select | Esc: back${RESET}`);

	return lines;
}

function renderWorktreeList(
	repo: RepoInfo,
	worktrees: WorktreeEntry[],
	selectedIndex: number,
	filter: string,
	cols: number,
	rows: number,
): string[] {
	const lines: string[] = [];
	const width = Math.max(cols - 4, 20);

	lines.push(`${BOLD}${COLORS.highlight} Select Worktree: ${repo.name}${RESET}`);
	lines.push("");

	if (filter) {
		lines.push(`${COLORS.muted}  Filter: ${RESET}${filter}`);
		lines.push("");
	}

	const filtered = worktrees.filter(
		(wt) => matchesFilter(wt.branch, filter) || matchesFilter(wt.path, filter),
	);

	if (filtered.length === 0) {
		lines.push(
			filter
				? `${DIM}  No worktrees matching "${filter}"${RESET}`
				: `${DIM}  No existing worktrees found.${RESET}`,
		);
	} else {
		// Fixed lines already pushed (title, blank, optional filter+blank) plus the 2 footer lines below.
		// Each entry costs 2 rows (branch + path); each shown indicator costs 1 row.
		// When the list overflows, reserve rows for both indicators up front so the
		// output never exceeds the terminal height.
		const fixedLinesUsed = lines.length + 2;
		const baseRemainingRows = Math.max(0, rows - fixedLinesUsed);
		const baseMaxVisible = Math.max(1, Math.floor(baseRemainingRows / 2));
		const maxVisible =
			filtered.length > baseMaxVisible
				? Math.max(1, Math.floor(Math.max(0, baseRemainingRows - 2) / 2))
				: baseMaxVisible;
		const window = computeListWindow(filtered.length, selectedIndex, maxVisible);

		if (window.start > 0) {
			lines.push(`${DIM}  ↑ ${window.start} more${RESET}`);
		}

		for (let i = window.start; i < window.end; i++) {
			const wt = filtered[i];
			if (!wt) continue;
			const isSelected = i === selectedIndex;
			const marker = isSelected ? `${COLORS.highlight}\u25b6${RESET}` : " ";
			const branchLabel = isSelected
				? `${BOLD}${COLORS.title}${wt.branch || "(detached)"}${RESET}`
				: `${COLORS.subtitle}${wt.branch || "(detached)"}${RESET}`;
			const pathLabel = `${COLORS.muted}${wt.path}${RESET}`;
			lines.push(truncate(` ${marker} ${branchLabel}`, width));
			lines.push(truncate(`     ${pathLabel}`, width));
		}

		if (window.end < filtered.length) {
			lines.push(`${DIM}  ↓ ${filtered.length - window.end} more${RESET}`);
		}
	}

	lines.push("");
	lines.push(`${COLORS.muted}  ↑/↓: navigate | Enter: select | Esc: back${RESET}`);
	lines.push(`${COLORS.muted}  Type to filter worktrees${RESET}`);

	return lines;
}

function renderBranchInput(
	repo: RepoInfo,
	branchName: string,
	fetchBeforeCreate: boolean,
	cols: number,
): string[] {
	const lines: string[] = [];
	const width = Math.max(cols - 4, 20);

	lines.push(`${BOLD}${COLORS.highlight} Create Session: ${repo.name}${RESET}`);
	lines.push("");
	const fetchLabel = fetchBeforeCreate ? "fetch origin first" : "no fetch";
	lines.push(`${COLORS.muted}  Enter branch name (${fetchLabel}):${RESET}`);
	lines.push("");
	lines.push(`  ${COLORS.border}${BOX.horizontal.repeat(width - 6)}${RESET}`);
	lines.push(`  ${BOLD}${branchName}${RESET}\u2588`);
	lines.push(`  ${COLORS.border}${BOX.horizontal.repeat(width - 6)}${RESET}`);
	lines.push("");

	if (branchName) {
		const preview = `${repo.name}--${branchName.replace(/\//g, "-")}`;
		lines.push(`${COLORS.muted}  Worktree dir: ${preview}${RESET}`);
	}

	lines.push("");
	lines.push(`${COLORS.muted}  Enter: create | Esc: back${RESET}`);

	return lines;
}

function renderFetchChoice(repo: RepoInfo, selectedIndex: number, cols: number): string[] {
	const lines: string[] = [];
	const width = Math.max(cols - 4, 20);

	lines.push(`${BOLD}${COLORS.highlight} Create Session: ${repo.name}${RESET}`);
	lines.push("");
	lines.push(`${COLORS.muted}  Refresh ${repo.defaultBranch} from origin before creating?${RESET}`);
	lines.push("");

	const options = [
		{
			label: `Fetch latest origin/${repo.defaultBranch} first`,
			desc: "Runs `git fetch origin` before git wt",
		},
		{ label: "Create without fetching", desc: "Use local refs as-is" },
	];

	for (let i = 0; i < options.length; i++) {
		const opt = options[i];
		if (!opt) continue;
		const isSelected = i === selectedIndex;
		const marker = isSelected ? `${COLORS.highlight}\u25b6${RESET}` : " ";
		const label = isSelected
			? `${BOLD}${COLORS.title}${opt.label}${RESET}`
			: `${COLORS.subtitle}${opt.label}${RESET}`;
		const desc = `${COLORS.muted}${opt.desc}${RESET}`;
		lines.push(truncate(` ${marker} ${label}`, width));
		lines.push(truncate(`     ${desc}`, width));
	}

	lines.push("");
	lines.push(`${COLORS.muted}  j/k: navigate | Enter: select | Esc: back${RESET}`);

	return lines;
}

function renderCreating(
	repo: RepoInfo,
	message: string,
	cols: number,
	animFrame: number,
): string[] {
	const lines: string[] = [];
	const frame = SPINNER_FRAMES[animFrame % SPINNER_FRAMES.length]!;

	lines.push(`${BOLD}${COLORS.highlight} Creating Session: ${repo.name}${RESET}`);
	lines.push("");
	lines.push(`  ${COLORS.highlight}${frame}${RESET} ${message}`);
	lines.push("");
	lines.push(`${COLORS.muted}  Please wait...${RESET}`);

	return lines;
}

export function renderWizard(
	wizard: WizardState,
	cols: number,
	rows: number,
	animFrame = 0,
): string {
	if (!wizard) return "";

	const output: string[] = [];
	output.push(CLEAR_SCREEN + CURSOR_HOME);

	let content: string[];

	switch (wizard.step) {
		case "select-repo":
			content = renderRepoList(wizard.repos, wizard.selectedIndex, wizard.filter, cols, rows);
			break;
		case "select-mode":
			content = renderModeSelect(wizard.repo, wizard.selectedIndex, cols);
			break;
		case "select-worktree":
			content = renderWorktreeList(
				wizard.repo,
				wizard.worktrees,
				wizard.selectedIndex,
				wizard.filter,
				cols,
				rows,
			);
			break;
		case "fetch-choice":
			content = renderFetchChoice(wizard.repo, wizard.selectedIndex, cols);
			break;
		case "enter-branch":
			content = renderBranchInput(wizard.repo, wizard.branchName, wizard.fetchBeforeCreate, cols);
			break;
		case "creating":
			content = renderCreating(wizard.repo, wizard.message, cols, animFrame);
			break;
	}

	output.push(...content);

	return output.join("\n");
}
