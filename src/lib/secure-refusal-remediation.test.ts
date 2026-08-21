import { describe, expect, it } from "vitest";
import { ACL_DETAIL } from "./secure-fs-posix.js";
import {
	ACL_PACKAGE_REMEDIATION,
	remediationForMessage,
	remediationForRefusal,
} from "./secure-refusal-remediation.js";

describe("remediationForRefusal", () => {
	it("maps the getfacl-absent detail to the acl-package remediation", () => {
		const line = remediationForRefusal(
			"unsupported-posix-acl",
			ACL_DETAIL.getfaclAbsent,
		);
		expect(line).toBe(ACL_PACKAGE_REMEDIATION);
		expect(line).toContain("acl");
		expect(line).toContain("apt install acl");
		expect(line).toContain("apk add acl");
		expect(line).toContain("dnf install acl");
	});

	it("gives NO package remediation for a real extended ACL entry", () => {
		expect(
			remediationForRefusal(
				"unsupported-posix-acl",
				ACL_DETAIL.extendedAclEntry,
			),
		).toBeUndefined();
	});

	it.each([
		["getfacl timeout", ACL_DETAIL.getfaclTimeout],
	])("gives no package remediation for %s", (_name, detail) => {
		expect(remediationForRefusal("unsupported-posix-acl", detail)).toBe(
			undefined,
		);
	});

	it("returns undefined for an unmapped refusal code", () => {
		expect(
			remediationForRefusal("unsafe-parent-chain", ACL_DETAIL.getfaclAbsent),
		).toBeUndefined();
		expect(remediationForRefusal("unsupported-posix-acl")).toBeUndefined();
	});
});

describe("remediationForMessage", () => {
	it("recognises the adapter-absent detail inside a transaction message", () => {
		expect(remediationForMessage("acl /home/user: getfacl absent")).toBe(
			ACL_PACKAGE_REMEDIATION,
		);
	});

	it("does NOT fire on a real extended-ACL refusal message", () => {
		expect(
			remediationForMessage("acl /home/user: extended ACL entry"),
		).toBeUndefined();
	});

	it("does NOT fire on an unrelated refusal message", () => {
		expect(
			remediationForMessage("refuse asset in state edited-managed"),
		).toBeUndefined();
	});

	it("only matches the detail as the message tail, never mid-prose", () => {
		expect(
			remediationForMessage("getfacl absent is not the cause here"),
		).toBeUndefined();
	});
});
