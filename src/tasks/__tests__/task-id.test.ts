import { describe, it, expect } from 'vitest';
import {
	generateTaskId,
	createTask,
	addSubtask,
	buildTaskTree,
	findTask,
} from '../task-id.js';

describe('generateTaskId', () => {
	it('is deterministic — same input produces same hash', () => {
		const a = generateTaskId({ title: 'Setup project' });
		const b = generateTaskId({ title: 'Setup project' });
		expect(a).toBe(b);
	});

	it('returns a 7-character string', () => {
		expect(generateTaskId({ title: 'hello' })).toHaveLength(7);
	});

	it('changes when title changes', () => {
		const a = generateTaskId({ title: 'Setup' });
		const b = generateTaskId({ title: 'Deploy' });
		expect(a).not.toBe(b);
	});

	it('changes when description changes', () => {
		const a = generateTaskId({ title: 'T', description: 'A' });
		const b = generateTaskId({ title: 'T', description: 'B' });
		expect(a).not.toBe(b);
	});

	it('changes when parentId changes', () => {
		const a = generateTaskId({ title: 'T', parentId: 'p1' });
		const b = generateTaskId({ title: 'T', parentId: 'p2' });
		expect(a).not.toBe(b);
	});
});

describe('createTask', () => {
	it('generates a TaskNode with hash ID', () => {
		const task = createTask({ title: 'Test task' });
		expect(task.id).toHaveLength(7);
		expect(task.title).toBe('Test task');
	});

	it('sets status to todo', () => {
		expect(createTask({ title: 'T' }).status).toBe('todo');
	});

	it('sets empty children and dependencies', () => {
		const task = createTask({ title: 'T' });
		expect(task.children).toEqual([]);
		expect(task.dependencies).toEqual([]);
	});

	it('sets ISO timestamps', () => {
		const task = createTask({ title: 'T' });
		expect(() => new Date(task.createdAt)).not.toThrow();
		expect(task.createdAt).toBe(task.updatedAt);
	});
});

describe('addSubtask', () => {
	it('links parent-child correctly', () => {
		const parent = createTask({ title: 'Parent' });
		const child = addSubtask(parent, { title: 'Child' });

		expect(child.parentId).toBe(parent.id);
		expect(parent.children).toContain(child);
		expect(parent.children).toHaveLength(1);
	});
});

describe('buildTaskTree', () => {
	it('builds hierarchy from flat list', () => {
		const parent = createTask({ title: 'Parent' });
		const child1 = createTask({ title: 'C1', parentId: parent.id });
		const child2 = createTask({ title: 'C2', parentId: parent.id });

		const tree = buildTaskTree([parent, child1, child2]);
		expect(tree).toHaveLength(1);
		expect(tree[0]!.children).toHaveLength(2);
	});

	it('returns only root nodes at top level', () => {
		const root = createTask({ title: 'Root' });
		const child = createTask({ title: 'Child', parentId: root.id });

		const tree = buildTaskTree([root, child]);
		expect(tree).toHaveLength(1);
		expect(tree[0]!.id).toBe(root.id);
	});
});

describe('findTask', () => {
	it('finds by ID recursively', () => {
		const parent = createTask({ title: 'Parent' });
		const child = addSubtask(parent, { title: 'Child' });

		const found = findTask([parent], child.id);
		expect(found).toBeDefined();
		expect(found!.title).toBe('Child');
	});

	it('returns undefined for non-existent ID', () => {
		const task = createTask({ title: 'T' });
		expect(findTask([task], 'nope')).toBeUndefined();
	});
});
