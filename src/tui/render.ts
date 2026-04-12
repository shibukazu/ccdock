import type { DeleteConfirm, SidebarState, WorkspaceSession } from "../types.ts";

const SPINNER_FRAMES = [
	"\u280b",
	"\u2819",
	"\u2839",
	"\u2838",
	"\u283c",
	"\u2834",
	"\u2826",
	"\u2827",
	"\u2807",
	"\u280f",
];
import {
	BOLD,
	BOX,
	CLEAR_SCREEN,
	COLORS,
	CURSOR_HOME,
	DIM,
	RESET,
	clearLine,
	moveCursor,
	shortenHome,
	statusColor,
	statusIcon,
	truncate,
	visibleLength,
} from "./ansi.ts";

function padRight(str: string, len: number): string {
	const visible = visibleLength(str);
	if (visible >= len) return str;
	return str + " ".repeat(len - visible);
}

function renderDeleteConfirm(deleteConfirm: DeleteConfirm): string[] {
	const lines: string[] = [];

	lines.push(`  ${BOLD}${COLORS.error} Delete session?${RESET}`);
	lines.push("");

	const options = ["Remove session only", "Remove session + worktree"];

	for (let i = 0; i < options.length; i++) {
		const opt = options[i];
		if (!opt) continue;
		const isSelected = i === deleteConfirm.selectedIndex;
		const marker = isSelected ? `${COLORS.highlight}\u25b6${RESET}` : " ";
		const label = isSelected
			? `${BOLD}${COLORS.title}${opt}${RESET}`
			: `${COLORS.subtitle}${opt}${RESET}`;
		lines.push(`    ${marker} ${label}`);
	}

	lines.push("");
	lines.push(`  ${COLORS.muted}Enter: confirm | Esc: cancel${RESET}`);

	return lines;
}

function renderCard(
	session: WorkspaceSession,
	isSelected: boolean,
	cols: number,
	animFrame: number,
	compact: boolean,
	deleteConfirm: DeleteConfirm | null,
	sessionIndex: number,
): string[] {
	const lines: string[] = [];
	const width = Math.max(cols - 2, 20);

	// Colors based on editor state
	// Focused: white border, normal title
	// Open: normal border + green ● dot
	// Closed: dim everything
	const editorState = session.editorState;
	const isFocused = editorState === "focused";
	const isClosed = editorState === "closed";
	const isLaunching = editorState === "launching";
	// Border color: VS Code focused > J/K selected > closed/open
	const borderColor = isFocused
		? COLORS.borderFocused
		: isSelected
			? COLORS.borderSelected
			: isClosed
				? COLORS.borderClosed
				: COLORS.border;
	const titleColor = isClosed ? COLORS.editorClosed : COLORS.title;
	const detailColor = isClosed ? COLORS.editorClosed : COLORS.subtitle;
	const dimAll = isClosed ? DIM : "";

	// Status dot: spinning for launching, green solid for open/focused, none for closed
	let openDot = "";
	if (isLaunching) {
		const frame = SPINNER_FRAMES[animFrame % SPINNER_FRAMES.length]!;
		openDot = `${COLORS.waiting}${frame}${RESET} `;
	} else if (!isClosed) {
		openDot = `${COLORS.running}\u25cf${RESET} `;
	}

	// Card border top
	const topBorder = `${dimAll}${borderColor}${BOX.topLeft}${BOX.horizontal.repeat(width - 2)}${BOX.topRight}${RESET}`;
	lines.push(topBorder);

	// Title line: #N + dot (if open) + icon + repo:branch
	const icon = "\uf418";
	const sessionNum = `${COLORS.muted}#${sessionIndex + 1}${RESET} `;
	const titleText = `${titleColor}${icon} ${session.repoName}:${session.branch}${RESET}`;
	const title = `${sessionNum}${openDot}${titleText}`;
	const titleTruncated = truncate(title, width - 4);
	const titleLine = `${dimAll}${borderColor}${BOX.vertical}${RESET} ${padRight(titleTruncated, width - 4)}${RESET} ${dimAll}${borderColor}${BOX.vertical}${RESET}`;
	lines.push(titleLine);

	if (!compact) {
		// Path line
		const shortPath = shortenHome(session.worktreePath);
		const pathTruncated = truncate(shortPath, width - 4);
		const pathColor = editorState === "closed" ? COLORS.editorClosed : COLORS.subtitle;
		const pathLine = `${dimAll}${borderColor}${BOX.vertical}${RESET} ${pathColor}${padRight(pathTruncated, width - 4)}${RESET} ${dimAll}${borderColor}${BOX.vertical}${RESET}`;
		lines.push(pathLine);

		// Agent status lines
		if (session.agents.length === 0) {
			const noAgent = `${DIM}no agents${RESET}`;
			const agentLine = `${dimAll}${borderColor}${BOX.vertical}${RESET} ${padRight(noAgent, width - 4)}${RESET} ${dimAll}${borderColor}${BOX.vertical}${RESET}`;
			lines.push(agentLine);
		} else {
			for (const agent of session.agents) {
				const sIcon = statusIcon(agent.status, animFrame);
				const sColor = statusColor(agent.status);
				const statusText = `${sColor}${sIcon} ${agent.status}${RESET}`;
				const agentInfo = `${statusText} ${detailColor}${agent.agentType}${RESET}`;
				const agentLine = `${dimAll}${borderColor}${BOX.vertical}${RESET} ${padRight(agentInfo, width - 4)}${RESET} ${dimAll}${borderColor}${BOX.vertical}${RESET}`;
				lines.push(agentLine);

				// Show latest tool activity
				if (agent.toolName) {
					const detail = agent.toolDetail
						? `${detailColor}${agent.toolName}${RESET} ${detailColor}${agent.toolDetail}${RESET}`
						: `${detailColor}${agent.toolName}${RESET}`;
					const detailTruncated = truncate(`  ${detail}`, width - 4);
					const detailLine = `${dimAll}${borderColor}${BOX.vertical}${RESET} ${padRight(detailTruncated, width - 4)}${RESET} ${dimAll}${borderColor}${BOX.vertical}${RESET}`;
					lines.push(detailLine);
				}
			}
		}
	} else {
		// Compact: just show agent status inline
		const agentSummary =
			session.agents.length > 0
				? session.agents
						.map((a) => `${statusColor(a.status)}${statusIcon(a.status, animFrame)}${RESET}`)
						.join(" ")
				: `${DIM}no agents${RESET}`;
		const compactLine = `${dimAll}${borderColor}${BOX.vertical}${RESET} ${padRight(agentSummary, width - 4)}${RESET} ${dimAll}${borderColor}${BOX.vertical}${RESET}`;
		lines.push(compactLine);
	}

	// Delete confirmation inline
	if (isSelected && deleteConfirm && deleteConfirm.sessionId === session.id) {
		const confirmLines = renderDeleteConfirm(deleteConfirm);
		for (const cl of confirmLines) {
			const confirmLine = `${dimAll}${borderColor}${BOX.vertical}${RESET} ${padRight(cl, width - 4)}${RESET} ${dimAll}${borderColor}${BOX.vertical}${RESET}`;
			lines.push(confirmLine);
		}
	}

	// Card border bottom
	const bottomBorder = `${dimAll}${borderColor}${BOX.bottomLeft}${BOX.horizontal.repeat(width - 2)}${BOX.bottomRight}${RESET}`;
	lines.push(bottomBorder);

	return lines;
}

function renderActivityLog(state: SidebarState, maxLines: number): string[] {
	const lines: string[] = [];
	const width = Math.max(state.cols - 2, 20);

	lines.push(`${COLORS.border}${BOX.horizontal.repeat(width)}${RESET}`);
	lines.push(`${BOLD}${COLORS.highlight} Activity Log${RESET}`);

	const entries = state.activityLog.slice(-maxLines);
	for (const entry of entries) {
		const sessionTag =
			entry.sessionIndex >= 0 ? `${COLORS.accent}#${entry.sessionIndex + 1}${RESET} ` : "";
		const detail = entry.toolDetail ? ` ${COLORS.muted}${entry.toolDetail}${RESET}` : "";
		const line = `${COLORS.muted}${entry.time}${RESET} ${sessionTag}${COLORS.highlight}${entry.tool}${RESET}${detail}`;
		lines.push(` ${truncate(line, width - 2)}`);
	}

	if (entries.length === 0) {
		lines.push(`${DIM}  (no activity yet)${RESET}`);
	}

	return lines;
}

function renderFooter(cols: number): string[] {
	const line1 = [
		`${BOLD}j/k${RESET} nav`,
		`${BOLD}Enter${RESET} focus`,
		`${BOLD}n${RESET} new`,
		`${BOLD}d${RESET} del`,
		`${BOLD}r${RESET} realign`,
	].join(`${COLORS.muted} | ${RESET}`);
	const line2 = [`${BOLD}c${RESET} compact`, `${BOLD}l${RESET} log`, `${BOLD}q${RESET} quit`].join(
		`${COLORS.muted} | ${RESET}`,
	);
	return [
		`${COLORS.muted}${BOX.horizontal.repeat(Math.max(cols - 2, 1))}${RESET}`,
		` ${truncate(line1, cols - 2)}`,
		` ${truncate(line2, cols - 2)}`,
	];
}

function renderQuitConfirm(selectedIndex: number, cols: number): string[] {
	const width = Math.max(cols - 4, 20);
	const lines: string[] = [];
	lines.push("");
	lines.push(`${BOLD}${COLORS.highlight} Quit ccdock?${RESET}`);
	lines.push("");

	const options = [
		"Quit sidebar only (keep VS Code open)",
		"Quit sidebar and close all VS Code windows",
	];

	for (let i = 0; i < options.length; i++) {
		const isSelected = i === selectedIndex;
		const marker = isSelected ? `${COLORS.highlight}\u25b6${RESET}` : " ";
		const label = isSelected
			? `${BOLD}${COLORS.title}${options[i]}${RESET}`
			: `${COLORS.subtitle}${options[i]}${RESET}`;
		lines.push(truncate(` ${marker} ${label}`, width));
	}

	lines.push("");
	lines.push(`${COLORS.muted}  Enter: confirm | Esc: cancel${RESET}`);
	return lines;
}

export function renderSidebar(state: SidebarState): string {
	const output: string[] = [];
	output.push(CLEAR_SCREEN + CURSOR_HOME);

	// Quit confirmation takes over the screen
	if (state.quitConfirm) {
		output.push(...renderQuitConfirm(state.quitConfirm.selectedIndex, state.cols));
		return output.join("\n");
	}

	// Header
	const header = `${BOLD}${COLORS.highlight} ccdock${RESET} ${COLORS.muted}(${state.sessions.length} sessions)${RESET}`;
	output.push(header);
	output.push("");

	// Calculate available space
	const footerHeight = 3;
	const headerHeight = 2;
	const logHeight = state.showActivityLog ? Math.min(8, state.activityLog.length + 2) : 0;
	const availableForCards = state.rows - headerHeight - footerHeight - logHeight;

	// Render session cards
	let linesUsed = 0;
	state.cardRowRanges = [];
	const cardStartOffset = output.length; // rows before cards (header)
	for (let i = 0; i < state.sessions.length; i++) {
		const session = state.sessions[i];
		if (!session) continue;
		const isSelected = i === state.selectedIndex;
		const cardLines = renderCard(
			session,
			isSelected,
			state.cols,
			state.animationFrame,
			state.compactMode,
			state.deleteConfirm,
			i,
		);

		if (linesUsed + cardLines.length > availableForCards) break;
		const startRow = cardStartOffset + linesUsed + 1; // 1-based row
		state.cardRowRanges.push({
			sessionIndex: i,
			startRow,
			endRow: startRow + cardLines.length - 1,
		});
		output.push(...cardLines);
		linesUsed += cardLines.length;
	}

	if (state.sessions.length === 0) {
		output.push("");
		output.push(`${DIM}  No active sessions.${RESET}`);
		output.push(`${DIM}  Press 'n' to create a new session.${RESET}`);
	}

	// Fill remaining space
	const currentLines = output.length;
	const targetLine = state.rows - footerHeight - logHeight;
	for (let i = currentLines; i < targetLine; i++) {
		output.push("");
	}

	// Activity log
	if (state.showActivityLog) {
		const logLines = renderActivityLog(state, 5);
		output.push(...logLines);
	}

	// Footer
	const footerLines = renderFooter(state.cols);
	output.push(...footerLines);

	return output.join("\n");
}
