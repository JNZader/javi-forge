/** Source-only diagnostic semantics. No HTTP client, credentials or runtime integration. */
const LIMIT = 1048576;
const RESULT = Object.freeze({ status: "ok" } as const);
function invalid(): never {
	throw new Error("STATUS_OK_INVALID");
}
function object(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		invalid();
	return value as Record<string, unknown>;
}
function exactStatus(value: unknown): void {
	const item = object(value);
	if (Object.keys(item).length !== 1 || item.status !== "ok") invalid();
}
function sessionIdentity(session: string): void {
	if (
		typeof session !== "string" ||
		!/^ses_[A-Za-z0-9_-]{1,128}$/.test(session)
	)
		invalid();
}

/** JSON.parse owns grammar; this second bounded walk rejects decoded duplicate keys.
 * Maximum nesting is 64 containers. Escaped keys compare after JSON string decoding.
 * Input is bounded before decoding; no reviver can recover overwritten duplicate keys.
 */
function uniqueKeys(text: string): void {
	let offset = 0;
	const whitespace = () => {
		while (/^[\t\n\r ]$/.test(text[offset] ?? "")) offset++;
	};
	const string = (): string => {
		const start = offset++;
		while (offset < text.length) {
			const char = text[offset++];
			if (char === "\\") offset++;
			else if (char === '"')
				return JSON.parse(text.slice(start, offset)) as string;
		}
		return invalid();
	};
	const visit = (depth: number): void => {
		whitespace();
		const char = text[offset];
		if (char === '"') {
			string();
			return;
		}
		if (char === "{" || char === "[") {
			if (depth >= 64) invalid();
			const isObject = char === "{";
			const close = isObject ? "}" : "]";
			const keys = new Set<string>();
			offset++;
			whitespace();
			if (text[offset] === close) {
				offset++;
				return;
			}
			for (;;) {
				if (isObject) {
					const key = string();
					if (keys.has(key)) invalid();
					keys.add(key);
					whitespace();
					offset++;
				}
				visit(depth + 1);
				whitespace();
				if (text[offset++] === close) return;
				whitespace();
			}
		}
		while (offset < text.length && !/[\t\n\r ,\]}]/.test(text[offset] ?? ""))
			offset++;
	};
	visit(0);
	whitespace();
	if (offset !== text.length) invalid();
}

export function parseStatusOk(raw: Uint8Array, session: string): typeof RESULT {
	try {
		sessionIdentity(session);
		if (!(raw instanceof Uint8Array) || raw.byteLength > LIMIT) invalid();
		// Preserve a BOM so JSON.parse rejects it rather than silently changing the input.
		const text = new TextDecoder("utf-8", {
			fatal: true,
			ignoreBOM: true,
		}).decode(raw);
		const value: unknown = JSON.parse(text);
		uniqueKeys(text);
		const response = object(value);
		const info = object(response.info);
		if (
			info.role !== "assistant" ||
			info.sessionID !== session ||
			info.providerID !== "opencode" ||
			info.modelID !== "mimo-v2.5-free" ||
			Object.hasOwn(info, "error") ||
			typeof info.id !== "string" ||
			info.id.length === 0
		)
			invalid();
		exactStatus(info.structured);
		if (!Array.isArray(response.parts)) invalid();
		const parts = response.parts.map(object);
		const tools = parts.filter((part) => part.type === "tool");
		if (tools.length !== 1) invalid();
		const tool = tools[0];
		if (
			!tool ||
			tool.tool !== "StructuredOutput" ||
			tool.sessionID !== session ||
			tool.messageID !== info.id
		)
			invalid();
		const state = object(tool.state);
		if (state.status !== "completed") invalid();
		// Both objects having exactly the single constant property proves deep equality.
		exactStatus(state.input);
		return RESULT;
	} catch {
		return invalid();
	}
}

const REQUEST = {
	model: { providerID: "opencode", modelID: "mimo-v2.5-free" },
	format: {
		type: "json_schema",
		schema: {
			type: "object",
			properties: { status: { const: "ok" } },
			required: ["status"],
			additionalProperties: false,
		},
		retryCount: 0,
	},
	parts: [
		{
			type: "text",
			text: 'Return exactly {"status":"ok"} using StructuredOutput.',
		},
	],
} as const;
type MockMessage = (
	session: string,
	request: typeof REQUEST,
) => Promise<Uint8Array>;
/** Test seam only: injection is not a security boundary and grants no execution authority.
 * Caller supplies a local mock, never a production transport. There is no retry/fallback.
 * No timeout guarantee is made for the injected promise or host work.
 */
export async function dispatchStatusOkMock(
	session: string,
	sendMock: MockMessage,
): Promise<typeof RESULT> {
	sessionIdentity(session);
	const request = structuredClone(REQUEST);
	const raw = await sendMock(session, request);
	return parseStatusOk(raw, session);
}
