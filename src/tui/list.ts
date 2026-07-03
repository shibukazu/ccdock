/** Case-insensitive substring match used for type-to-filter lists. An empty filter matches everything. */
export function matchesFilter(text: string, filter: string): boolean {
	if (!filter) return true;
	return text.toLowerCase().includes(filter.toLowerCase());
}
