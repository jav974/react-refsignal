export default class Stack<T> {
    items: T[] = [];

    push(item: T): void {
        this.items.push(item);
    }

    pop(): T | undefined {
        return this.items.pop();
    }

    peek(): T | undefined {
        return this.isEmpty() ? undefined : this.items[this.size() - 1];
    }

    size(): number {
        return this.items.length;
    }

    isEmpty(): boolean {
        return this.size() === 0;
    }
}
