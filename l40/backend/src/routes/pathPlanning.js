import { Router } from 'express';
import { query } from '../db/init.js';

const router = Router();

const MAX_EDGE_DISTANCE = 15;

function distance3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function planPathDijkstra(nodes, edges, startId, endId) {
  const maxPriority = Math.max(...nodes.map((n) => n.priority || 3), 1);
  const adjacency = new Map();
  nodes.forEach((n) => adjacency.set(n.id, []));
  edges.forEach((e) => {
    if (!e.walkable) return;
    const target = nodes.find((n) => n.id === e.to);
    if (!target) return;
    const priorityFactor = (target.priority || 3) / maxPriority;
    const weight = e.distance / Math.max(priorityFactor, 0.1);
    adjacency.get(e.from)?.push({ to: e.to, weight, distance: e.distance });
  });

  const dist = new Map();
  const prev = new Map();
  const visited = new Set();
  nodes.forEach((n) => dist.set(n.id, Infinity));
  dist.set(startId, 0);

  while (true) {
    let u = null;
    let minDist = Infinity;
    for (const [nodeId, d] of dist) {
      if (!visited.has(nodeId) && d < minDist) {
        minDist = d;
        u = nodeId;
      }
    }
    if (u === null || u === endId) break;
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

  if (dist.get(endId) === Infinity) return null;

  const path = [];
  let current = endId;
  while (current !== undefined) {
    path.unshift(current);
    current = prev.get(current);
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  let cumulativeDistance = 0;
  return path.map((nodeId, idx) => {
    const node = nodeMap.get(nodeId);
    if (idx > 0) {
      const prevNodeId = path[idx - 1];
      const edge = edges.find((e) => e.from === prevNodeId && e.to === nodeId && e.walkable);
      cumulativeDistance += edge ? edge.distance : distance3D(nodeMap.get(prevNodeId).position, node.position);
    }
    return {
      nodeId,
      equipmentId: node.equipmentId,
      name: node.name,
      position: node.position,
      priority: node.priority || 3,
      cumulativeDistance,
    };
  });
}

router.post('/plan', async (req, res, next) => {
  try {
    const { equipmentIds = [], startPosition, priorities = {} } = req.body;

    if (equipmentIds.length === 0) {
      return res.status(400).json({ error: 'equipmentIds is required and must not be empty' });
    }

    const nodesResult = await query('SELECT * FROM factory_graph_nodes ORDER BY id');
    const edgesResult = await query('SELECT * FROM factory_graph_edges WHERE walkable = true ORDER BY id');

    const allNodes = nodesResult.rows.map((row) => ({
      id: row.id,
      equipmentId: row.equipment_id,
      name: row.equipment_name || `Node ${row.id}`,
      position: { x: parseFloat(row.position_x), y: parseFloat(row.position_y), z: parseFloat(row.position_z) },
      priority: priorities[row.equipment_id] || row.priority || 3,
    }));

    const allEdges = edgesResult.rows.map((row) => ({
      from: row.from_node_id,
      to: row.to_node_id,
      distance: parseFloat(row.distance),
      walkable: row.walkable,
    }));

    const targetEquipmentSet = new Set(equipmentIds);
    const targetNodes = allNodes.filter((n) => targetEquipmentSet.has(n.equipmentId));

    if (targetNodes.length === 0) {
      return res.status(404).json({ error: 'No matching equipment found in graph' });
    }

    let startNodeId;
    if (startPosition) {
      let closestDist = Infinity;
      for (const n of allNodes) {
        const d = distance3D(startPosition, n.position);
        if (d < closestDist) {
          closestDist = d;
          startNodeId = n.id;
        }
      }
    } else {
      startNodeId = allNodes[0].id;
    }

    const visited = new Set([startNodeId]);
    const route = [startNodeId];
    let current = startNodeId;
    const targetNodeIds = targetNodes.map((n) => n.id);
    const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
    let totalDistance = 0;

    while (visited.size < targetNodeIds.length + 1) {
      const unvisited = targetNodeIds.filter((id) => !visited.has(id));
      if (unvisited.length === 0) break;

      let bestNext = null;
      let bestScore = Infinity;

      for (const candidate of unvisited) {
        const segmentPath = planPathDijkstra(allNodes, allEdges, current, candidate);
        if (!segmentPath) continue;

        const candidateNode = nodeMap.get(candidate);
        const maxPriority = Math.max(...targetNodes.map((n) => n.priority || 3), 1);
        const priorityBoost = (candidateNode.priority || 3) / maxPriority;
        const score = segmentPath[segmentPath.length - 1].cumulativeDistance / Math.max(priorityBoost, 0.1);

        if (score < bestScore) {
          bestScore = score;
          bestNext = {
            nodeId: candidate,
            distance: segmentPath[segmentPath.length - 1].cumulativeDistance,
          };
        }
      }

      if (!bestNext) break;
      visited.add(bestNext.nodeId);
      route.push(bestNext.nodeId);
      totalDistance += bestNext.distance;
      current = bestNext.nodeId;
    }

    const fullPath = [];
    for (let i = 0; i < route.length; i++) {
      if (i === 0) {
        const node = nodeMap.get(route[i]);
        fullPath.push({
          nodeId: node.id,
          equipmentId: node.equipmentId,
          name: node.name,
          position: node.position,
          priority: node.priority || 3,
          cumulativeDistance: 0,
        });
      } else {
        const segmentPath = planPathDijkstra(allNodes, allEdges, route[i - 1], route[i]);
        if (segmentPath && segmentPath.length > 1) {
          for (let j = 1; j < segmentPath.length; j++) {
            fullPath.push(segmentPath[j]);
          }
        } else {
          const node = nodeMap.get(route[i]);
          const prevNode = nodeMap.get(route[i - 1]);
          fullPath.push({
            nodeId: node.id,
            equipmentId: node.equipmentId,
            name: node.name,
            position: node.position,
            priority: node.priority || 3,
            cumulativeDistance: (fullPath[fullPath.length - 1]?.cumulativeDistance || 0) + distance3D(prevNode.position, node.position),
          });
        }
      }
    }

    const walkSpeed = 1.2;
    const walkTimeMin = (totalDistance / walkSpeed) / 60;
    const inspectionTimeMin = targetNodes.length * 5;
    const estimatedTime = walkTimeMin + inspectionTimeMin;

    res.json({
      path: fullPath,
      totalDistance,
      estimatedTime,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/graph', async (req, res, next) => {
  try {
    const nodesResult = await query('SELECT * FROM factory_graph_nodes ORDER BY id');
    const edgesResult = await query('SELECT * FROM factory_graph_edges ORDER BY id');

    const nodes = nodesResult.rows.map((row) => ({
      id: row.id,
      equipmentId: row.equipment_id,
      equipmentName: row.equipment_name,
      position: { x: parseFloat(row.position_x), y: parseFloat(row.position_y), z: parseFloat(row.position_z) },
      priority: row.priority,
      floor: row.floor,
      zone: row.zone,
    }));

    const edges = edgesResult.rows.map((row) => ({
      id: row.id,
      from: row.from_node_id,
      to: row.to_node_id,
      distance: parseFloat(row.distance),
      walkable: row.walkable,
      isBidirectional: row.is_bidirectional,
      blockedReason: row.blocked_reason,
    }));

    res.json({ nodes, edges });
  } catch (err) {
    next(err);
  }
});

router.put('/graph', async (req, res, next) => {
  try {
    const { addEdges = [], removeEdges = [], blockEdges = [], unblockEdges = [] } = req.body;

    for (const edge of addEdges) {
      await query(
        'INSERT INTO factory_graph_edges (from_node_id, to_node_id, distance, walkable, is_bidirectional, blocked_reason) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [edge.from, edge.to, edge.distance || 0, edge.walkable !== false, edge.isBidirectional !== false, edge.blockedReason || null]
      );
    }

    for (const edgeId of removeEdges) {
      await query('DELETE FROM factory_graph_edges WHERE id = $1', [edgeId]);
    }

    for (const edgeId of blockEdges) {
      await query('UPDATE factory_graph_edges SET walkable = false, blocked_reason = $1 WHERE id = $2', ['Blocked by user', edgeId]);
    }

    for (const edgeId of unblockEdges) {
      await query('UPDATE factory_graph_edges SET walkable = true, blocked_reason = NULL WHERE id = $1', [edgeId]);
    }

    res.json({ success: true, message: 'Graph updated' });
  } catch (err) {
    next(err);
  }
});

router.post('/navigation', async (req, res, next) => {
  try {
    const { currentPath = [], currentPosition = { x: 0, y: 0, z: 0 }, waypointIndex = 0 } = req.body;

    if (currentPath.length === 0) {
      return res.status(400).json({ error: 'currentPath is required' });
    }

    const nextIdx = Math.min(waypointIndex, currentPath.length - 1);
    const target = currentPath[nextIdx];

    if (!target) {
      return res.status(400).json({ error: 'Invalid waypoint index' });
    }

    const dx = target.position.x - currentPosition.x;
    const dz = target.position.z - currentPosition.z;
    const bearing = Math.atan2(dx, dz) * (180 / Math.PI);
    const dist = Math.sqrt(dx * dx + dz * dz);

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

    res.json({
      nextWaypoint: target,
      bearing,
      distance: dist,
      direction,
      arrived: dist < 1.5,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
