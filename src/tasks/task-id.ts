import { createHash } from 'node:crypto';

export type TaskStatus = 'todo' | 'in-progress' | 'done';

export type TaskNode = {
	id: string;
	title: string;
	description?: string;
	status: TaskStatus;
	parentId?: string;
	children: TaskNode[];
	dependencies: string[];
	assignee?: string;
	createdAt: string;
	updatedAt: string;
};

export function generateTaskId(content: {
	title: string;
	description?: string;
	parentId?: string;
}): string {
	const input = [content.title, content.description ?? '', content.parentId ?? ''].join('|');
	return createHash('sha256').update(input).digest('hex').slice(0, 7);
}

export function createTask(params: {
	title: string;
	description?: string;
	parentId?: string;
}): TaskNode {
	const now = new Date().toISOString();
	return {
		id: generateTaskId(params),
		title: params.title,
		description: params.description,
		status: 'todo',
		parentId: params.parentId,
		children: [],
		dependencies: [],
		createdAt: now,
		updatedAt: now,
	};
}

export function addSubtask(
	parent: TaskNode,
	childParams: { title: string; description?: string },
): TaskNode {
	const child = createTask({
		title: childParams.title,
		description: childParams.description,
		parentId: parent.id,
	});
	parent.children.push(child);
	return child;
}

export function buildTaskTree(flat: TaskNode[]): TaskNode[] {
	const map = new Map<string, TaskNode>();
	for (const node of flat) {
		map.set(node.id, { ...node, children: [] });
	}

	const roots: TaskNode[] = [];
	for (const node of map.values()) {
		if (node.parentId && map.has(node.parentId)) {
			map.get(node.parentId)!.children.push(node);
		} else {
			roots.push(node);
		}
	}

	return roots;
}

export function findTask(tree: TaskNode[], id: string): TaskNode | undefined {
	for (const node of tree) {
		if (node.id === id) return node;
		const found = findTask(node.children, id);
		if (found) return found;
	}
	return undefined;
}
