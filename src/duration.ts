const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000 };

// "90s", "15m", "2h", "1.5h" -> milliseconds; null for anything else.
export function parseDuration(text: string): number | null {
	const match = /^(\d+(?:\.\d+)?)([smh])$/.exec(text.trim());
	if (match === null) return null;
	const ms = Number(match[1]) * UNIT_MS[match[2]];
	return ms > 0 ? ms : null;
}
