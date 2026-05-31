const MAX_EDGE_DISTANCE = 15;
const DEFAULT_WALK_SPEED = 1.2;
const ARRIVAL_THRESHOLD = 1.5;

function distance3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function lineIntersectsObstacle(p1, p2, obstacle) {
  const { position, radius } = obstacle;
  const dx = p2.x - p1.x;
  const dz = p2.z - p1.z;
  const fx = p1.x - position.x;
  const fz = p1.z - position.z;

  const a = dx * dx + dz * dz;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - radius * radius;

  let discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return false;

  discriminant = Math.sqrt(discriminant);
  const t1 = (-b - discriminant) / (2 * a);
  const t2 = (-b + discriminant) / (2 * a);

  return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1) || (t1 < 0 && t2 > 1);
}

export function buildGraph(equipmentList, obstacles = [], manualEdges = []) {
  const nodes = [];
  const edges = [];
  const nodeMap = new Map();

  equipmentList.forEach((eq) => {
    const pos = Array.isArray(eq.position)
      ? { x: eq.position[0], y: eq.position[1], z: eq.position[2] }
      : eq.position || { x: 0, y: 0, z: 0 };

    const node = {
      id: `node_${eq.id}`,
      equipmentId: eq.id,
      name: eq.name || `Equipment ${eq.id}`,
      position: pos,
      priority: eq.priority || 3,
    };
    nodes.push(node);
    nodeMap.set(node.id, node);
  });

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const dist = distance3D(a.position, b.position);

      if (dist > MAX_EDGE_DISTANCE) continue;

      let blocked = false;
      for (const obs of obstacles) {
        if (lineIntersectsObstacle(a.position, b.position, obs)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      edges.push({ from: a.id, to: b.id, distance: dist, walkable: true });
      edges.push({ from: b.id, to: a.id, distance: dist, walkable: true });
    }
  }

  for (const me of manualEdges) {
    const existingIdx = edges.findIndex(
      (e) => e.from === me.from && e.to === me.to
    );
    if (existingIdx >= 0) {
      edges[existingIdx] = { ...edges[existingIdx], ...me };
    } else {
      const fromNode = nodeMap.get(me.from);
      const toNode = nodeMap.get(me.to);
      if (fromNode && toNode) {
        const dist = me.distance ?? distance3D(fromNode.position, toNode.position);
        edges.push({ from: me.from, to: me.to, distance: dist, walkable: me.walkable !== false });
      }
    }
  }

  return { nodes, edges, nodeMap };
}

export function planPath(graph, startNodeId, endNodeId) {
  const { nodes, edges } = graph;
  const maxPriority = Math.max(...nodes.map((n) => n.priority), 1);

  const adjacency = new Map();
  nodes.forEach((n) => adjacency.set(n.id, []));
  edges.forEach((e) => {
    if (!e.walkable) return;
    const targetNode = nodes.find((n) => n.id === e.to);
    if (!targetNode) return;
    const priorityFactor = targetNode.priority / maxPriority;
    const weight = e.distance / Math.max(priorityFactor, 0.1);
    adjacency.get(e.from).push({ to: e.to, weight, distance: e.distance });
  });

  const dist = new Map();
  const prev = new Map();
  const visited = new Set();

  nodes.forEach((n) => dist.set(n.id, Infinity));
  dist.set(startNodeId, 0);

  while (true) {
    let u = null;
    let minDist = Infinity;
    for (const [nodeId, d] of dist) {
      if (!visited.has(nodeId) && d < minDist) {
        minDist = d;
        u = nodeId;
      }
    }
    if (u === null || u === endNodeId) break;
    visited.add(u);

    for (const neighbor of adjacency.get(u) || []) {
      if (visited.has(neighbor.to)) continue;
      const alt = dist.get(u) + neighbor.weight;
      if (alt < dist.get(neighbor.to)) {
        dist.set(neighbor.to, alt);
        prev.set(neighbor.to, u);
      }
    }
  }

  if (dist.get(endNodeId) === Infinity) return null;

  const path = [];
  let current = endNodeId;
  while (current !== undefined) {
    path.unshift(current);
    current = prev.get(current);
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  let cumulativeDistance = 0;
  const result = path.map((nodeId, idx) => {
    const node = nodeMap.get(nodeId);
    if (idx > 0) {
      const prevNodeId = path[idx - 1];
      const edge = edges.find(
        (e) => e.from === prevNodeId && e.to === nodeId && e.walkable
      );
      cumulativeDistance += edge ? edge.distance : distance3D(
        nodeMap.get(prevNodeId).position,
        node.position
      );
    }
    return {
      nodeId,
      equipmentId: node.equipmentId,
      name: node.name,
      position: node.position,
      priority: node.priority,
      cumulativeDistance,
    };
  });

  return {
    path: result,
    totalDistance: cumulativeDistance,
    totalWeight: dist.get(endNodeId),
  };
}

export function planInspectionRoute(graph, startNodeId, equipmentIds) {
  const { nodes } = graph;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const targetNodeIds = equipmentIds
    .map((eqId) => nodes.find((n) => n.equipmentId === eqId))
    .filter(Boolean)
    .map((n) => n.id);

  if (targetNodeIds.length === 0) return null;

  const maxPriority = Math.max(...targetNodeIds.map((id) => nodeMap.get(id).priority), 1);
  const visited = new Set([startNodeId]);
  const route = [startNodeId];
  let current = startNodeId;
  let totalDist = 0;

  while (visited.size < targetNodeIds.length + 1) {
    const unvisited = targetNodeIds.filter((id) => !visited.has(id));
    if (unvisited.length === 0) break;

    let bestNext = null;
    let bestScore = Infinity;

    for (const candidate of unvisited) {
      const pathResult = planPath(graph, current, candidate);
      if (!pathResult) continue;

      const candidateNode = nodeMap.get(candidate);
      const priorityBoost = candidateNode.priority / maxPriority;
      const score = pathResult.totalDistance / Math.max(priorityBoost, 0.1);

      if (score < bestScore) {
        bestScore = score;
        bestNext = { nodeId: candidate, path: pathResult, distance: pathResult.totalDistance };
      }
    }

    if (!bestNext) break;

    visited.add(bestNext.nodeId);
    route.push(bestNext.nodeId);
    totalDist += bestNext.distance;
    current = bestNext.nodeId;
  }

  let cumulativeDistance = 0;
  const result = route.map((nodeId, idx) => {
    const node = nodeMap.get(nodeId);
    if (idx > 0) {
      const segmentPath = planPath(graph, route[idx - 1], nodeId);
      cumulativeDistance += segmentPath ? segmentPath.totalDistance : distance3D(
        nodeMap.get(route[idx - 1]).position,
        node.position
      );
    }
    return {
      nodeId,
      equipmentId: node.equipmentId,
      name: node.name,
      position: node.position,
      priority: node.priority,
      cumulativeDistance,
    };
  });

  return {
    path: result,
    totalDistance: cumulativeDistance,
  };
}

export function getNavigationSteps(path, currentPosition) {
  if (!path || path.length === 0) return null;

  let closestIdx = 0;
  let closestDist = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = distance3D(currentPosition, path[i].position);
    if (d < closestDist) {
      closestDist = d;
      closestIdx = i;
    }
  }

  const nextIdx = closestDist < ARRIVAL_THRESHOLD ? Math.min(closestIdx + 1, path.length - 1) : closestIdx;
  const target = path[nextIdx];

  const dx = target.position.x - currentPosition.x;
  const dz = target.position.z - currentPosition.z;
  const bearing = Math.atan2(dx, dz) * (180 / Math.PI);
  const dist = distance3D(currentPosition, path[nextIdx].position);

  let direction = '';
  if (Math.abs(bearing) < 22.5) direction = 'Straight ahead';
  else if (bearing < 0 && bearing > -67.5) direction = 'Slight left';
  else if (bearing <= -67.5 && bearing > -112.5) direction = 'Left';
  else if (bearing <= -112.5 && bearing > -157.5) direction = 'Sharp left';
  else if (bearing <= -157.5) direction = 'Behind left';
  else if (bearing > 0 && bearing < 67.5) direction = 'Slight right';
  else if (bearing >= 67.5 && bearing < 112.5) direction = 'Right';
  else if (bearing >= 112.5 && bearing < 157.5) direction = 'Sharp right';
  else direction = 'Behind right';

  return {
    nextWaypoint: target,
    nextWaypointIndex: nextIdx,
    bearing,
    distance: dist,
    direction,
    arrived: closestDist < ARRIVAL_THRESHOLD && nextIdx > closestIdx,
  };
}

export function estimateTotalTime(path, walkSpeed = DEFAULT_WALK_SPEED) {
  if (!path || path.length === 0) return 0;
  const totalDist = path[path.length - 1].cumulativeDistance;
  const walkTimeMin = (totalDist / walkSpeed) / 60;
  const inspectionTimeMin = path.length * 5;
  return walkTimeMin + inspectionTimeMin;
}

export function getDemoGraph() {
  const equipmentList = [
    { id: 1, name: 'CNC Milling Machine X500', position: { x: -5, y: 0, z: -10 }, priority: 5 },
    { id: 2, name: 'Industrial Robot Arm R2000', position: { x: 0, y: 0, z: -5 }, priority: 4 },
    { id: 3, name: 'Hydraulic Press HP-300', position: { x: 5, y: 0, z: -10 }, priority: 3 },
  ];
  return buildGraph(equipmentList, [], [
    { from: 'node_1', to: 'node_2', walkable: true },
    { from: 'node_2', to: 'node_1', walkable: true },
    { from: 'node_2', to: 'node_3', walkable: true },
    { from: 'node_3', to: 'node_2', walkable: true },
    { from: 'node_1', to: 'node_3', walkable: true },
    { from: 'node_3', to: 'node_1', walkable: true },
  ]);
}
