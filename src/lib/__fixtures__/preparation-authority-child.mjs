// Inert test-only actor: fixture public key/evidence, no key generation or issuance.
import { createPublicKey } from "node:crypto";
import { ApprovalAuthority } from "../preparation-authorization.ts";

let authority;
let approval;
process.on("message", (message) => {
	if (message.kind === "configure") {
		try {
			authority = new ApprovalAuthority(
				createPublicKey(message.publicKey),
				message.root,
			);
			approval = authority.verify(message.evidence, message.binding, 1000);
			process.send({ status: "ready" });
		} catch {
			process.send({ status: "failed" });
			process.disconnect();
		}
	} else if (message.kind === "consume") {
		try {
			authority.consume(approval, 1000);
			process.send({ status: "consumed" });
		} catch {
			process.send({ status: "denied" });
		} finally {
			authority.close();
			process.disconnect();
		}
	}
});
