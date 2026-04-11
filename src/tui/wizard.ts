import type { RepoInfo, WizardState, WorktreeEntry } from "../types.ts";
import { BOLD, BOX, CLEAR_SCREEN, COLORS, CURSOR_HOME, DIM, RESET, truncate } from "./ansi.ts";

function renderRepoList(
	repos: RepoInfo[],
	selectedIndex: number,
	filter: string,
	cols: number,
): string[] {
	const lines: string[] = [];
	const width = Math.max(cols - 4, 20);

	lines.push(`${BOLD}${COLORS.highlight} Select Repository${RESET}`);
	lines.push("");

	if (filter) {
		lines.push(`${COLORS.muted}  Filter: ${RESET}${filter}`);
		lines.push("");
	}

	const filtered = repos.filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()));

	if (filtered.length === 0) {
		lines.push(`${DIM}  No repos matching "${filter}"${RESET}`);
	} else {
		for (let i = 0; i < filtered.length; i++) {
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
	}

	lines.push("");
	lines.push(`${COLORS.muted}  j/k: navigate | Enter: select | Esc: cancel${RESET}`);
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
	cols: number,
): string[] {
	const lines: string[] = [];
	const width = Math.max(cols - 4, 20);

	lines.push(`${BOLD}${COLORS.highlight} Select Worktree: ${repo.name}${RESET}`);
	lines.push("");

	if (worktrees.length === 0) {
		lines.push(`${DIM}  No existing worktrees found.${RESET}`);
	} else {
		for (let i = 0; i < worktrees.length; i++) {
			const wt = worktrees[i];
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
	}

	lines.push("");
	lines.push(`${COLORS.muted}  j/k: navigate | Enter: select | Esc: back${RESET}`);

	return lines;
}

function renderBranchInput(repo: RepoInfo, branchName: string, cols: number): string[] {
	const lines: string[] = [];
	const width = Math.max(cols - 4, 20);

	lines.push(`${BOLD}${COLORS.highlight} Create Session: ${repo.name}${RESET}`);
	lines.push("");
	lines.push(`${COLORS.muted}  Enter branch name:${RESET}`);
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

export function renderWizard(wizard: WizardState, cols: number): string {
	if (!wizard) return "";

	const output: string[] = [];
	output.push(CLEAR_SCREEN + CURSOR_HOME);

	let content: string[];

	switch (wizard.step) {
		case "select-repo":
			content = renderRepoList(wizard.repos, wizard.selectedIndex, wizard.filter, cols);
			break;
		case "select-mode":
			content = renderModeSelect(wizard.repo, wizard.selectedIndex, cols);
			break;
		case "select-worktree":
			content = renderWorktreeList(wizard.repo, wizard.worktrees, wizard.selectedIndex, cols);
			break;
		case "enter-branch":
			content = renderBranchInput(wizard.repo, wizard.branchName, cols);
			break;
	}

	output.push(...content);

	return output.join("\n");
}
