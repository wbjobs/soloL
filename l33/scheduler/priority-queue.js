class PriorityQueue {
  constructor() {
    this.queue = [];
  }

  enqueue(task) {
    const priority = task.priority || 5;
    const item = { task, priority, timestamp: Date.now() };
    
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      if (priority > this.queue[i].priority ||
          (priority === this.queue[i].priority && item.timestamp < this.queue[i].timestamp)) {
        this.queue.splice(i, 0, item);
        inserted = true;
        break;
      }
    }
    
    if (!inserted) {
      this.queue.push(item);
    }
  }

  dequeue() {
    if (this.isEmpty()) return null;
    return this.queue.shift().task;
  }

  peek() {
    if (this.isEmpty()) return null;
    return this.queue[0].task;
  }

  remove(taskId) {
    const index = this.queue.findIndex(item => item.task.task_id === taskId);
    if (index !== -1) {
      return this.queue.splice(index, 1)[0].task;
    }
    return null;
  }

  isEmpty() {
    return this.queue.length === 0;
  }

  size() {
    return this.queue.length;
  }

  getTasks() {
    return this.queue.map(item => item.task);
  }
}

module.exports = PriorityQueue;
