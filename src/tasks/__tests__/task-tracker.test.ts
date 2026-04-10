import { describe, it, expect } from 'vitest';
import { TaskTracker } from '../task-tracker.js';

describe('TaskTracker', () => {
	it('addTask creates with todo status', () => {
		const tracker = new TaskTracker();
		const task = tracker.addTask('Test');
		expect(task.status).toBe('todo');
	});

	it('updateStatus transitions correctly', () => {
		const tracker = new TaskTracker();
		const task = tracker.addTask('Test');
		tracker.updateStatus(task.id, 'in-progress');
		expect(task.status).toBe('in-progress');
		tracker.updateStatus(task.id, 'done');
		expect(task.status).toBe('done');
	});

	it('updateStatus throws for non-existent task', () => {
		const tracker = new TaskTracker();
		expect(() => tracker.updateStatus('nope', 'done')).toThrow('not found');
	});

	it('assignTask sets assignee', () => {
		const tracker = new TaskTracker();
		const task = tracker.addTask('Test');
		tracker.assignTask(task.id, 'javier');
		expect(task.assignee).toBe('javier');
	});

	it('assignTask throws for non-existent task', () => {
		const tracker = new TaskTracker();
		expect(() => tracker.assignTask('nope', 'x')).toThrow('not found');
	});

	it('addDependency creates link', () => {
		const tracker = new TaskTracker();
		const t1 = tracker.addTask('A');
		const t2 = tracker.addTask('B');
		tracker.addDependency(t2.id, t1.id);
		expect(t2.dependencies).toContain(t1.id);
	});

	it('addDependency throws for non-existent task', () => {
		const tracker = new TaskTracker();
		const t1 = tracker.addTask('A');
		expect(() => tracker.addDependency('nope', t1.id)).toThrow('not found');
	});

	it('getBlockedTasks returns tasks with incomplete deps', () => {
		const tracker = new TaskTracker();
		const t1 = tracker.addTask('Setup');
		const t2 = tracker.addTask('Deploy');
		tracker.addDependency(t2.id, t1.id);

		const blocked = tracker.getBlockedTasks();
		expect(blocked).toHaveLength(1);
		expect(blocked[0]!.id).toBe(t2.id);
	});

	it('getBlockedTasks returns empty when all deps done', () => {
		const tracker = new TaskTracker();
		const t1 = tracker.addTask('Setup');
		const t2 = tracker.addTask('Deploy');
		tracker.addDependency(t2.id, t1.id);
		tracker.updateStatus(t1.id, 'done');

		expect(tracker.getBlockedTasks()).toHaveLength(0);
	});

	it('getReadyTasks returns todo tasks with all deps done', () => {
		const tracker = new TaskTracker();
		const t1 = tracker.addTask('Setup');
		const t2 = tracker.addTask('Deploy');
		tracker.addDependency(t2.id, t1.id);

		expect(tracker.getReadyTasks().map((t) => t.id)).toEqual([t1.id]);

		tracker.updateStatus(t1.id, 'done');
		expect(tracker.getReadyTasks().map((t) => t.id)).toEqual([t2.id]);
	});

	it('getReadyTasks excludes in-progress and done tasks', () => {
		const tracker = new TaskTracker();
		const t1 = tracker.addTask('A');
		tracker.addTask('B');
		tracker.updateStatus(t1.id, 'in-progress');
		const ready = tracker.getReadyTasks();
		expect(ready.every((t) => t.status === 'todo')).toBe(true);
	});

	it('toMarkdown produces valid markdown', () => {
		const tracker = new TaskTracker();
		tracker.addTask('Task 1');
		const t2 = tracker.addTask('Task 2');
		tracker.updateStatus(t2.id, 'done');
		tracker.assignTask(t2.id, 'javier');

		const md = tracker.toMarkdown();
		expect(md).toContain('- [ ] Task 1');
		expect(md).toContain('- [x] Task 2 @javier');
	});

	it('toJSON / fromJSON roundtrip preserves data', () => {
		const tracker = new TaskTracker();
		const t1 = tracker.addTask('Setup', 'Init repo');
		const t2 = tracker.addTask('Deploy');
		tracker.addDependency(t2.id, t1.id);
		tracker.assignTask(t1.id, 'javier');
		tracker.updateStatus(t1.id, 'done');

		const json = tracker.toJSON();
		const restored = TaskTracker.fromJSON(json);
		expect(restored.toJSON()).toBe(json);
	});
});
