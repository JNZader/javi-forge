/**
 * Pure refusal → remediation table for the CLI layer (Linux hardening, Slice A).
 *
 * The secure-fs adapters stay PROVERS: they emit stable `SecureRefusal` codes
 * plus a stable detail token and carry ZERO user copy. This module is the only
 * place that turns one of those tokens into an actionable next step, so the
 * proof algorithms and their refusal identities never move when the copy does.
 *
 * The table is deliberately narrow. A remediation is emitted ONLY when the user
 * can actually fix the cause: an unresolvable `getfacl` is fixed by installing
 * the `acl` package, while a REAL extended ACL (the adapter ran and found a
 * named-user entry) is not — suggesting a package install there would be
 * actively misleading. No I/O, no rendering, no Ink.
 */

import { ACL_DETAIL } from "./secure-fs-posix.js";
import type { SecureRefusal } from "./secure-fs-transaction.js";

/** The one actionable line for a host whose POSIX ACL adapter is missing. */
export const ACL_PACKAGE_REMEDIATION =
	"install the acl package (provides getfacl): apt install acl · apk add acl · dnf install acl";

/** Detail tokens that map to a remediation, keyed by refusal code. */
const REMEDIATION_TABLE: Partial<
	Record<SecureRefusal, Record<string, string>>
> = {
	"unsupported-posix-acl": {
		[ACL_DETAIL.getfaclAbsent]: ACL_PACKAGE_REMEDIATION,
	},
};

/**
 * The actionable line for a refusal + detail pair, or `undefined` when nothing
 * the user can do would change the outcome.
 */
export function remediationForRefusal(
	refusal: SecureRefusal,
	detail?: string,
): string | undefined {
	if (detail === undefined) return undefined;
	return REMEDIATION_TABLE[refusal]?.[detail];
}

/**
 * The same lookup for an already-rendered refusal MESSAGE (the transaction
 * flattens `refusal`/`detail` into strings such as `acl /path: getfacl absent`).
 * Matching is anchored to the message TAIL so prose that merely mentions the
 * token never triggers a wrong hint.
 */
export function remediationForMessage(message: string): string | undefined {
	for (const details of Object.values(REMEDIATION_TABLE)) {
		for (const [detail, line] of Object.entries(details)) {
			if (message.endsWith(detail)) return line;
		}
	}
	return undefined;
}
