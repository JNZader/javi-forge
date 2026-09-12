import React, { useEffect, useState } from "react";
import { type DoctorOptions, runDoctor } from "../../commands/doctor.js";
import type { DoctorResult } from "../../types/index.js";
import Doctor from "../../ui/Doctor.js";

export default function DoctorController(options: DoctorOptions = {}) {
	const { dryRun = false, refreshContext = false } = options;
	const [result, setResult] = useState<DoctorResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const runCheck = () => {
		setLoading(true);
		setResult(null);
		setError(null);
		void runDoctor(undefined, { dryRun, refreshContext })
			.then((nextResult) => {
				setResult(nextResult);
				setLoading(false);
			})
			.catch((nextError: unknown) => {
				setError(String(nextError));
				setLoading(false);
			});
	};

	useEffect(() => {
		runCheck();
	}, [dryRun, refreshContext]);

	return (
		<Doctor
			loading={loading}
			result={result}
			error={error}
			onRerun={runCheck}
		/>
	);
}
