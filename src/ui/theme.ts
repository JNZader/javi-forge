export const theme = {
	primary: "#f97316", // orange
	success: "green",
	warning: "yellow",
	error: "red",
	muted: "gray",
	accent: "magenta",
} as const;

export type ThemeColor = (typeof theme)[keyof typeof theme];
