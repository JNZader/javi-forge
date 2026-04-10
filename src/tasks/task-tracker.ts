import { createTask, type TaskNode, type TaskStatus } from './task-id.js';

export class TaskTracker {
	private tasks: TaskNode[] = [];

	addTask(title: string, description?: string, parentId?: string): TaskNode {
		const task = createTask({ title, description, parentId });

		if (parentId) {
			const parent = this.findFlat(parentId);
			if (parent) {
				parent.children.push(task);
			}
		}

		this.tasks.push(task);
		return task;
	}

	updateStatus(id: string, status: TaskStatus): void {
		const task = this.findFlat(id);
		if (!task) throw new Error(`Task "${id}" not found`);
		task.status = status;
		task.updatedAt = new Date().toISOString();
	}

	assignTask(id: string, assignee: string): void {
		const task = this.findFlat(id);
		if (!task) throw new Error(`Task "${id}" not found`);
		task.assignee = assignee;
		task.updatedAt = new Date().toISOString();
	}

	addDependency(taskId: string, dependsOnId: string): void {
		const task = this.findFlat(taskId);
		if (!task) throw new Error(`Task "${taskId}" not found`);
		const dep = this.findFlat(dependsOnId);
		if (!dep) throw new Error(`Dependency "${dependsOnId}" not found`);
		task.dependencies.push(dependsOnId);
	}

	getBlockedTasks(): TaskNode[] {
		return this.tasks.filter((t) => {
			if (t.dependencies.length === 0) return false;
			return t.dependencies.some((depId) => {
				const dep = this.findFlat(depId);
				return !dep || dep.status !== 'done';
			});
		});
	}

	getReadyTasks(): TaskNode[] {
		return this.tasks.filter((t) => {
			if (t.status !== 'todo') return false;
			if (t.dependencies.length === 0) return true;
			return t.dependencies.every((depId) => {
				const dep = this.findFlat(depId);
				return dep?.status === 'done';
			});
		});
	}

	toMarkdown(): string {
		return this.tasks
			.map((t) => {
				const check = t.status === 'done' ? 'x' : ' ';
				const assignee = t.assignee ? ` @${t.assignee}` : '';
				return `- [${check}] ${t.title}${assignee}`;
			})
			.join('\n');
	}

	toJSON(): string {
		return JSON.stringify(this.tasks);
	}

	static fromJSON(json: string): TaskTracker {
		const tracker = new TaskTracker();
		tracker.tasks = JSON.parse(json) as TaskNode[];
		return tracker;
	}

	private findFlat(id: string): TaskNode | undefined {
		return this.tasks.find((t) => t.id === id);
	}
}
