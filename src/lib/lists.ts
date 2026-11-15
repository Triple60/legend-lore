/** Split a comma-separated field into trimmed, non-empty entries. */
export const splitList = (s: string): string[] =>
	s
		.split(',')
		.map((x) => x.trim())
		.filter(Boolean);
