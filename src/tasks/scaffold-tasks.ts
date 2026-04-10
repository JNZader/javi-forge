import { createTask, addSubtask, type TaskNode } from './task-id.js';

export function getDefaultScaffoldTasks(): TaskNode[] {
	const setup = createTask({ title: 'Setup project structure' });
	addSubtask(setup, { title: 'Initialize git repository' });
	addSubtask(setup, { title: 'Configure TypeScript' });
	addSubtask(setup, { title: 'Setup linter and formatter' });

	const testing = createTask({ title: 'Setup testing' });
	addSubtask(testing, { title: 'Configure test runner' });
	addSubtask(testing, { title: 'Write initial tests' });

	const ci = createTask({ title: 'Create CI pipeline' });
	const deploy = createTask({ title: 'Deploy to production' });

	return [setup, testing, ci, deploy];
}
