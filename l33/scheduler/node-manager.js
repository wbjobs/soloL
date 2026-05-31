const config = require('../config');

class NodeManager {
  constructor() {
    this.nodes = new Map();
    this.heartbeatTimeout = config.node.heartbeatTimeoutMs;
  }

  registerNode(nodeId, hardware, address) {
    const node = {
      id: nodeId,
      hardware,
      address,
      status: 'online',
      registered_at: Date.now(),
      last_heartbeat: Date.now(),
      current_tasks: [],
      load: 0
    };
    
    this.nodes.set(nodeId, node);
    return node;
  }

  updateHeartbeat(nodeId, load, runningTasks) {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.last_heartbeat = Date.now();
      node.load = load;
      node.current_tasks = runningTasks || [];
      node.status = 'online';
      return true;
    }
    return false;
  }

  getNode(nodeId) {
    return this.nodes.get(nodeId);
  }

  getAllNodes() {
    return Array.from(this.nodes.values());
  }

  getAvailableNodes() {
    const now = Date.now();
    return Array.from(this.nodes.values())
      .filter(n => n.status === 'online' && (now - n.last_heartbeat) < this.heartbeatTimeout)
      .sort((a, b) => a.load - b.load);
  }

  checkOfflineNodes() {
    const now = Date.now();
    const offlineNodes = [];
    
    for (const [nodeId, node] of this.nodes) {
      if (node.status === 'online' && (now - node.last_heartbeat) >= this.heartbeatTimeout) {
        node.status = 'offline';
        offlineNodes.push(nodeId);
      }
    }
    
    return offlineNodes;
  }

  removeNode(nodeId) {
    return this.nodes.delete(nodeId);
  }
}

module.exports = NodeManager;
