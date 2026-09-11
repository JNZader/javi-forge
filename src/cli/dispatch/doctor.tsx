import { createElement, useEffect, useState } from "react";
import { type DoctorOptions, runDoctor } from "../../commands/doctor.js";
import type { DoctorResult } from "../../types/index.js";
import Doctor from "../../ui/Doctor.js";

export default function DoctorController({
	dryRun = false,
	refreshContext = false,
}: DoctorOptions) {
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
			.catch((nextError) => {
				setError(String(nextError));
				setLoading(false);
			});
	};

	useEffect(() => {
		runCheck();
	}, [dryRun, refreshContext]);

	return createElement(Doctor, { loading, result, error, onRerun: runCheck });
}
