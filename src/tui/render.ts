import type {
	DeleteConfirm,
	PendingCreation,
	SidebarState,
	WindowCloseConfirm,
	WorkspaceSession,
} from "../types.ts";
import type { WorktreeDiff } from "../worktree/diff.ts";
import { GROUP_LABELS, type SessionGroup, groupOfSession } from "./grouping.ts";

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
	agentTypeIcon,
	clearLine,
	formatElapsed,
	formatMem,
	moveCursor,
	shortenHome,
	statusBadge,
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

// Re-assert a background color after every RESET in the content so a selection
// highlight spans the whole field even when inner segments reset their styling.
function applyBg(content: string, bg: string): string {
	return `${bg}${content.split(RESET).join(`${RESET}${bg}`)}${RESET}`;
}

// Group heading row: `── Active (2) ──────────` in a muted rule style.
function groupHeading(group: SessionGroup, count: number, width: number): string {
	const label = `${GROUP_LABELS[group]} (${count})`;
	const prefix = `── ${label} `;
	const fill = Math.max(0, width - visibleLength(prefix));
	return `${COLORS.muted}${prefix}${"─".repeat(fill)}${RESET}`;
}

// diff badge line body: `~files +additions -deletions`. Returns "" when there
// are no changes at all so callers can skip the row.
function diffBadgeText(diff: WorktreeDiff): string {
	if (diff.files === 0 && diff.additions === 0 && diff.deletions === 0) return "";
	const parts: string[] = [];
	if (diff.files > 0) parts.push(`${COLORS.diffFile}~${diff.files}${RESET}`);
	if (diff.additions > 0) parts.push(`${COLORS.diffAdd}+${diff.additions}${RESET}`);
	if (diff.deletions > 0) parts.push(`${COLORS.diffDel}-${diff.deletions}${RESET}`);
	return parts.join(" ");
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

function renderWindowCloseConfirm(target: WindowCloseConfirm["target"]): string[] {
	const lines: string[] = [];

	const heading = target === "terminal" ? "Close terminal window?" : "Close editor window?";
	lines.push(`  ${BOLD}${COLORS.waiting} ${heading}${RESET}`);
	lines.push(`  ${COLORS.subtitle}Session and worktree will be kept${RESET}`);
	lines.push("");
	lines.push(`  ${COLORS.muted}Enter: close | Esc: cancel${RESET}`);

	return lines;
}

function renderPendingCard(pending: PendingCreation, cols: number, animFrame: number): string[] {
	const lines: string[] = [];
	const width = Math.max(cols - 2, 20);
	const isError = pending.status === "error";
	const borderColor = isError ? COLORS.error : COLORS.waiting;
	const titleColor = isError ? COLORS.error : COLORS.waiting;

	const topBorder = `${borderColor}${BOX.topLeft}${BOX.horizontal.repeat(width - 2)}${BOX.topRight}${RESET}`;
	lines.push(topBorder);

	const icon = isError ? "✕" : SPINNER_FRAMES[animFrame % SPINNER_FRAMES.length]!;
	const titleText = `${titleColor}${icon} ${pending.repoName}:${pending.branch}${RESET}`;
	const titleTruncated = truncate(titleText, width - 4);
	const titleLine = `${borderColor}${BOX.vertical}${RESET} ${padRight(titleTruncated, width - 4)}${RESET} ${borderColor}${BOX.vertical}${RESET}`;
	lines.push(titleLine);

	if (isError) {
		const errMsg = pending.errorMessage ?? "Unknown error";
		const errTruncated = truncate(`${COLORS.error}${errMsg}${RESET}`, width - 4);
		const errLine = `${borderColor}${BOX.vertical}${RESET} ${padRight(errTruncated, width - 4)}${RESET} ${borderColor}${BOX.vertical}${RESET}`;
		lines.push(errLine);

		const hint = `${COLORS.muted}(press d to dismiss)${RESET}`;
		const hintLine = `${borderColor}${BOX.vertical}${RESET} ${padRight(hint, width - 4)}${RESET} ${borderColor}${BOX.vertical}${RESET}`;
		lines.push(hintLine);
	} else {
		const msgLine = `${borderColor}${BOX.vertical}${RESET} ${padRight(pending.message, width - 4)}${RESET} ${borderColor}${BOX.vertical}${RESET}`;
		lines.push(msgLine);
	}

	const bottomBorder = `${borderColor}${BOX.bottomLeft}${BOX.horizontal.repeat(width - 2)}${BOX.bottomRight}${RESET}`;
	lines.push(bottomBorder);

	return lines;
}

function renderCard(
	session: WorkspaceSession,
	isSelected: boolean,
	cols: number,
	animFrame: number,
	compact: boolean,
	deleteConfirm: DeleteConfirm | null,
	windowCloseConfirm: WindowCloseConfirm | null,
	sessionIndex: number,
	isDeleting: boolean,
	diff: WorktreeDiff | null,
): string[] {
	const lines: string[] = [];
	const width = Math.max(cols - 2, 20);

	// Colors based on editor state
	// Focused: white border, normal title
	// Open: normal border + green ● dot
	// Closed: dim everything
	// Deleting: error-colored border, spinner
	const editorState = session.editorState;
	const terminalState = session.terminalState;
	const isFocused = editorState === "focused" || terminalState === "focused";
	// "Closed" (dim) styling only applies when both the editor and terminal are
	// closed — an open terminal keeps the card visually active.
	const isClosed = editorState === "closed" && terminalState === "closed";
	const isLaunching = editorState === "launching";
	const isTerminalLaunching = terminalState === "launching";
	// Border color: Deleting > editor/terminal focused > J/K selected > closed/open
	const borderColor = isDeleting
		? COLORS.error
		: isFocused
			? COLORS.borderFocused
			: isSelected
				? COLORS.borderSelected
				: isClosed
					? COLORS.borderClosed
					: COLORS.border;
	const titleColor = isDeleting ? COLORS.error : isClosed ? COLORS.editorClosed : COLORS.title;
	const detailColor = isClosed ? COLORS.editorClosed : COLORS.subtitle;
	const dimAll = isClosed && !isDeleting ? DIM : "";

	// Status indicators on the title line:
	//   - editor: spinner while launching (state is otherwise shown via border).
	//   - terminal: a `T` badge — spinner while launching, teal when open/focused.
	// Per-agent dots are rendered below; the session itself does not get one.
	let openDot = "";
	if (isLaunching) {
		const frame = SPINNER_FRAMES[animFrame % SPINNER_FRAMES.length]!;
		openDot = `${COLORS.waiting}${frame}${RESET} `;
	}
	let terminalDot = "";
	if (isTerminalLaunching) {
		const frame = SPINNER_FRAMES[animFrame % SPINNER_FRAMES.length]!;
		terminalDot = `${COLORS.waiting}${frame}T${RESET} `;
	} else if (terminalState === "focused") {
		terminalDot = `${COLORS.editorFocused}●T${RESET} `;
	} else if (terminalState === "open") {
		terminalDot = `${COLORS.stopped}●T${RESET} `;
	}

	// Card border top
	const topBorder = `${dimAll}${borderColor}${BOX.topLeft}${BOX.horizontal.repeat(width - 2)}${BOX.topRight}${RESET}`;
	lines.push(topBorder);

	// Title line: #N + dot (if open) + icon + repo:branch, with an elapsed-time
	// stamp (and a \u25b8 chevron when selected) right-aligned at the far edge.
	const icon = "\uf418";
	const sessionNum = `${COLORS.muted}#${sessionIndex + 1}${RESET} `;
	const titleText = `${titleColor}${icon} ${session.repoName}:${session.branch}${RESET}`;
	const titleLeft = `${sessionNum}${openDot}${terminalDot}${titleText}`;

	// Right stamp: most-recent agent update, else the session's own activity time.
	const latestAgentTs = session.agents.reduce((max, a) => Math.max(max, a.updatedAt), 0);
	const stampBase = latestAgentTs > 0 ? latestAgentTs : session.lastActiveAt;
	const elapsed = formatElapsed(Date.now() - stampBase);
	const chevron = isSelected ? " \u203a" : "";
	const rightStamp = `${COLORS.muted}${elapsed}${chevron}${RESET}`;
	const rightWidth = visibleLength(rightStamp);

	// Left column gets whatever the stamp does not use (min 1, leave a gap).
	const leftWidth = Math.max(1, width - 4 - rightWidth - 1);
	const leftTruncated = truncate(titleLeft, leftWidth);
	// Pad the left so the stamp sits flush right within the width-4 field.
	const titleInner = `${padRight(leftTruncated, width - 4 - rightWidth)}${rightStamp}`;
	const titleField = isSelected ? applyBg(titleInner, COLORS.bgSelected) : titleInner;
	const titleLine = `${dimAll}${borderColor}${BOX.vertical}${RESET} ${titleField}${RESET} ${dimAll}${borderColor}${BOX.vertical}${RESET}`;
	lines.push(titleLine);

	if (!compact) {
		// Path line
		const shortPath = shortenHome(session.worktreePath);
		const pathTruncated = truncate(shortPath, width - 4);
		const pathColor = isClosed ? COLORS.editorClosed : COLORS.subtitle;
		const pathLine = `${dimAll}${borderColor}${BOX.vertical}${RESET} ${pathColor}${padRight(pathTruncated, width - 4)}${RESET} ${dimAll}${borderColor}${BOX.vertical}${RESET}`;
		lines.push(pathLine);

		if (isDeleting) {
			const frame = SPINNER_FRAMES[animFrame % SPINNER_FRAMES.length]!;
			const deleteText = `${COLORS.error}${frame} Deleting session...${RESET}`;
			const deleteLine = `${dimAll}${borderColor}${BOX.vertical}${RESET} ${padRight(deleteText, width - 4)}${RESET} ${dimAll}${borderColor}${BOX.vertical}${RESET}`;
			lines.push(deleteLine);
		} else if (session.agents.length === 0) {
			const noAgent = `${DIM}no agents${RESET}`;
			const agentLine = `${dimAll}${borderColor}${BOX.vertical}${RESET} ${padRight(noAgent, width - 4)}${RESET} ${dimAll}${borderColor}${BOX.vertical}${RESET}`;
			lines.push(agentLine);
		} else {
			for (const agent of session.agents) {
				// Agent row: [ STATUS ] pill + agent-type glyph + type name.
				const badge = statusBadge(agent.status);
				const sColor = statusColor(agent.status);
				const typeIcon = `${sColor}${agentTypeIcon(agent.agentType)}${RESET}`;
				const agentInfo = `${badge} ${typeIcon} ${detailColor}${agent.agentType}${RESET}`;
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

		// Working-tree diff badge (`~files +adds -dels`); omitted when unchanged.
		if (diff) {
			const badgeText = diffBadgeText(diff);
			if (badgeText) {
				const diffTruncated = truncate(badgeText, width - 4);
				const diffLine = `${dimAll}${borderColor}${BOX.vertical}${RESET} ${padRight(diffTruncated, width - 4)}${RESET} ${dimAll}${borderColor}${BOX.vertical}${RESET}`;
				lines.push(diffLine);
			}
		}
	} else {
		// Compact: just show agent status inline
		let agentSummary: string;
		if (isDeleting) {
			const frame = SPINNER_FRAMES[animFrame % SPINNER_FRAMES.length]!;
			agentSummary = `${COLORS.error}${frame} deleting${RESET}`;
		} else if (session.agents.length > 0) {
			agentSummary = session.agents
				.map((a) => `${statusColor(a.status)}${statusIcon(a.status, animFrame)}${RESET}`)
				.join(" ");
		} else {
			agentSummary = `${DIM}no agents${RESET}`;
		}
		if (diff) {
			const badgeText = diffBadgeText(diff);
			if (badgeText) agentSummary = `${agentSummary}  ${badgeText}`;
		}
		const compactSummary = truncate(agentSummary, width - 4);
		const compactLine = `${dimAll}${borderColor}${BOX.vertical}${RESET} ${padRight(compactSummary, width - 4)}${RESET} ${dimAll}${borderColor}${BOX.vertical}${RESET}`;
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

	// Window close confirmation inline
	if (isSelected && windowCloseConfirm && windowCloseConfirm.sessionId === session.id) {
		const confirmLines = renderWindowCloseConfirm(windowCloseConfirm.target);
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

const USAGE_LABEL_WIDTH = 6;

function formatUsageRow(label: string, cpu: number, mem: number, suffix = ""): string {
	const paddedLabel = padRight(label, USAGE_LABEL_WIDTH);
	return ` ${COLORS.muted}${paddedLabel}${RESET} ${BOLD}${cpu.toFixed(1)}%${RESET} ${COLORS.muted}/${RESET} ${BOLD}${formatMem(mem)}${RESET}${suffix}`;
}

function renderUsageSummary(state: SidebarState): string[] {
	let totalCpu = 0;
	let totalMem = 0;
	let live = 0;
	for (const session of state.sessions) {
		for (const agent of session.agents) {
			if (typeof agent.cpuPercent === "number") totalCpu += agent.cpuPercent;
			if (typeof agent.memoryMb === "number") totalMem += agent.memoryMb;
			if (typeof agent.pid === "number") live++;
		}
	}
	const agentLabel = live === 1 ? "agent" : "agents";
	const agentSuffix = ` ${COLORS.muted}(${live} ${agentLabel})${RESET}`;
	const lines = [formatUsageRow("AGENT", totalCpu, totalMem, agentSuffix)];

	const editor = state.editorUsage;
	if (editor) {
		lines.push(formatUsageRow("EDITOR", editor.cpuPercent, editor.memoryMb));
	}
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
		`${BOLD}t${RESET} term`,
		`${BOLD}w${RESET} close ed`,
		`${BOLD}W${RESET} close term`,
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
		"Quit sidebar only (keep editors and terminals open)",
		"Quit sidebar and close all editor and terminal windows",
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
	const usageLines = renderUsageSummary(state);
	const usageHeight = usageLines.length;
	const availableForCards = state.rows - headerHeight - footerHeight - logHeight - usageHeight;

	// Render pending creation cards (overlay, not part of state.sessions)
	let linesUsed = 0;
	const cardStartOffset = output.length; // rows before cards (header)
	for (const pending of state.pendingCreations) {
		const pendingLines = renderPendingCard(pending, state.cols, state.animationFrame);
		if (linesUsed + pendingLines.length > availableForCards) break;
		output.push(...pendingLines);
		linesUsed += pendingLines.length;
	}

	// Render session cards, grouped by state (Active → Ready → Closed). The
	// sessions array is already sorted into group order upstream, so a group
	// heading is emitted whenever the group changes. Headings sit outside
	// cardRowRanges (like pending cards) so they are never click targets.
	state.cardRowRanges = [];
	const width = Math.max(state.cols - 2, 20);
	// Per-group counts (whole array, independent of what fits on screen).
	const groupCounts = new Map<string, number>();
	for (const s of state.sessions) {
		const g = groupOfSession(s);
		groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);
	}
	let currentGroup: string | null = null;
	for (let i = 0; i < state.sessions.length; i++) {
		const session = state.sessions[i];
		if (!session) continue;

		const group = groupOfSession(session);
		const headingLine =
			group !== currentGroup ? groupHeading(group, groupCounts.get(group) ?? 0, width) : null;

		const isSelected = i === state.selectedIndex;
		const diff = state.worktreeDiffs?.get(session.worktreePath) ?? null;
		const cardLines = renderCard(
			session,
			isSelected,
			state.cols,
			state.animationFrame,
			state.compactMode,
			state.deleteConfirm,
			state.windowCloseConfirm,
			i,
			state.deletingSessionIds.has(session.id),
			diff,
		);

		const extra = headingLine ? 1 : 0;
		if (linesUsed + extra + cardLines.length > availableForCards) break;
		if (headingLine) {
			output.push(headingLine);
			linesUsed += 1;
			currentGroup = group;
		}
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
	const targetLine = state.rows - footerHeight - logHeight - usageHeight;
	for (let i = currentLines; i < targetLine; i++) {
		output.push("");
	}

	output.push(...usageLines);

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
