/** Case-insensitive substring match used for type-to-filter lists. An empty filter matches everything. */
export function matchesFilter(text: string, filter: string): boolean {
	if (!filter) return true;
	return text.toLowerCase().includes(filter.toLowerCase());
}

function clamp(value: number, upperBound: number): number {
	return Math.max(0, Math.min(value, upperBound));
}

/**
 * Compute the visible slice [start, end) of a list given the total item
 * count, the currently selected index, and how many items can fit on
 * screen. The window is centered on the selection and clamped to the list
 * bounds. Purely derived from its inputs — no internal scroll state.
 */
export function computeListWindow(
	total: number,
	selectedIndex: number,
	maxVisible: number,
): { start: number; end: number } {
	if (total <= 0 || maxVisible <= 0) return { start: 0, end: 0 };
	if (total <= maxVisible) return { start: 0, end: total };

	const start = clamp(selectedIndex - Math.floor(maxVisible / 2), total - maxVisible);
	const end = start + maxVisible;
	return { start, end };
}
