import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button, Space, Tooltip, ColorPicker, Slider, Divider } from 'antd';
import {
  ArrowRightOutlined,
  RadiusSettingOutlined,
  EditOutlined,
  DragOutlined,
  DeleteOutlined,
  UndoOutlined,
  ClearOutlined,
} from '@ant-design/icons';
import * as THREE from 'three';
import { sendAnnotation, sendClear, sendUndo, sendCursor } from '../services/webrtc';

const TOOLS = {
  arrow: 'arrow',
  circle: 'circle',
  freehand: 'freehand',
  cursor: 'cursor',
  eraser: 'eraser',
};

const TOOL_CONFIGS = [
  { key: TOOLS.arrow, icon: <ArrowRightOutlined />, label: 'Arrow' },
  { key: TOOLS.circle, icon: <RadiusSettingOutlined />, label: 'Circle' },
  { key: TOOLS.freehand, icon: <EditOutlined />, label: 'Freehand' },
  { key: TOOLS.cursor, icon: <DragOutlined />, label: 'Cursor' },
  { key: TOOLS.eraser, icon: <DeleteOutlined />, label: 'Eraser' },
];

const DEFAULT_COLORS = ['#ff4444', '#ffaa00', '#00ddff', '#44ff44', '#ff44ff', '#ffffff'];

function screenToNDC(x, y, rect) {
  return {
    x: ((x - rect.left) / rect.width) * 2 - 1,
    y: -((y - rect.top) / rect.height) * 2 + 1,
  };
}

function raycastPoint(ndc, camera, scene, fallbackPlane) {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);

  const intersects = raycaster.intersectObjects(scene.children, true);
  if (intersects.length > 0) {
    return intersects[0].point.clone();
  }

  const planeIntersect = new THREE.Vector3();
  const hit = raycaster.ray.intersectPlane(fallbackPlane, planeIntersect);
  return hit ? planeIntersect : null;
}

export default function ExpertAnnotationTool({ r3fCanvas, sceneRef, cameraRef, author = 'expert', visible = true }) {
  const [activeTool, setActiveTool] = useState(null);
  const [color, setColor] = useState('#ff4444');
  const [lineWidth, setLineWidth] = useState(3);
  const [drawing, setDrawing] = useState(false);

  const overlayRef = useRef(null);
  const drawStartRef = useRef(null);
  const freehandPointsRef = useRef([]);
  const authorRef = useRef(author);
  authorRef.current = author;

  const getThreeContext = useCallback(() => {
    if (!r3fCanvas) return null;
    const rect = r3fCanvas.getBoundingClientRect();
    const camera = cameraRef?.current;
    const scene = sceneRef?.current;
    if (!camera || !scene) return null;

    const fallbackPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const camPos = camera.position.clone();
    fallbackPlane.setFromNormalAndCoplanarPoint(camDir.negate(), camPos.add(camDir.negate().multiplyScalar(5)));

    return { rect, camera, scene, fallbackPlane };
  }, [r3fCanvas, cameraRef, sceneRef]);

  const handleMouseDown = useCallback(
    (e) => {
      if (!activeTool || activeTool === TOOLS.cursor || activeTool === TOOLS.eraser) return;
      e.preventDefault();
      setDrawing(true);

      const ctx = getThreeContext();
      if (!ctx) return;

      const ndc = screenToNDC(e.clientX, e.clientY, ctx.rect);
      const point3D = raycastPoint(ndc, ctx.camera, ctx.scene, ctx.fallbackPlane);

      drawStartRef.current = { screenX: e.clientX, screenY: e.clientY, point3D, ndc };

      if (activeTool === TOOLS.freehand) {
        freehandPointsRef.current = point3D ? [point3D] : [];
      }
    },
    [activeTool, getThreeContext]
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (!drawing || !activeTool) return;

      const ctx = getThreeContext();
      if (!ctx) return;

      const ndc = screenToNDC(e.clientX, e.clientY, ctx.rect);

      if (activeTool === TOOLS.cursor) {
        const point3D = raycastPoint(ndc, ctx.camera, ctx.scene, ctx.fallbackPlane);
        if (point3D) {
          sendCursor({ position: { x: point3D.x, y: point3D.y, z: point3D.z }, author: authorRef.current });
        }
        return;
      }

      if (activeTool === TOOLS.freehand && drawStartRef.current) {
        const point3D = raycastPoint(ndc, ctx.camera, ctx.scene, ctx.fallbackPlane);
        if (point3D) {
          freehandPointsRef.current.push(point3D);
        }
      }

      if (overlayRef.current) {
        const canvas = overlayRef.current;
        const ctx2d = canvas.getContext('2d');
        ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        drawPreview(ctx2d, e);
      }
    },
    [drawing, activeTool, getThreeContext]
  );

  const drawPreview = useCallback(
    (ctx2d, e) => {
      if (!drawStartRef.current) return;
      const startX = drawStartRef.current.screenX - overlayRef.current.getBoundingClientRect().left;
      const startY = drawStartRef.current.screenY - overlayRef.current.getBoundingClientRect().top;
      const curX = e.clientX - overlayRef.current.getBoundingClientRect().left;
      const curY = e.clientY - overlayRef.current.getBoundingClientRect().top;

      ctx2d.strokeStyle = color;
      ctx2d.lineWidth = lineWidth;
      ctx2d.setLineDash([]);

      if (activeTool === TOOLS.arrow) {
        ctx2d.beginPath();
        ctx2d.moveTo(startX, startY);
        ctx2d.lineTo(curX, curY);
        ctx2d.stroke();
        const angle = Math.atan2(curY - startY, curX - startX);
        const headLen = 15;
        ctx2d.beginPath();
        ctx2d.moveTo(curX, curY);
        ctx2d.lineTo(curX - headLen * Math.cos(angle - 0.4), curY - headLen * Math.sin(angle - 0.4));
        ctx2d.moveTo(curX, curY);
        ctx2d.lineTo(curX - headLen * Math.cos(angle + 0.4), curY - headLen * Math.sin(angle + 0.4));
        ctx2d.stroke();
      } else if (activeTool === TOOLS.circle) {
        const dx = curX - startX;
        const dy = curY - startY;
        const radius = Math.sqrt(dx * dx + dy * dy);
        ctx2d.beginPath();
        ctx2d.arc(startX, startY, radius, 0, Math.PI * 2);
        ctx2d.stroke();
      } else if (activeTool === TOOLS.freehand) {
        if (freehandPointsRef.current.length < 2) return;
        const rect = overlayRef.current.getBoundingClientRect();
        ctx2d.beginPath();
        ctx2d.moveTo(startX, startY);
        for (let i = 1; i < freehandPointsRef.current.length; i++) {
          ctx2d.lineTo(curX, curY);
        }
        ctx2d.stroke();
      }
    },
    [activeTool, color, lineWidth]
  );

  const handleMouseUp = useCallback(
    (e) => {
      if (!drawing) return;
      setDrawing(false);

      const ctx = getThreeContext();
      if (!ctx || !drawStartRef.current) {
        drawStartRef.current = null;
        return;
      }

      const ndc = screenToNDC(e.clientX, e.clientY, ctx.rect);
      const endPoint3D = raycastPoint(ndc, ctx.camera, ctx.scene, ctx.fallbackPlane);
      const startPoint3D = drawStartRef.current.point3D;

      if (overlayRef.current) {
        const ctx2d = overlayRef.current.getContext('2d');
        ctx2d.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      }

      if (!startPoint3D || !endPoint3D) {
        drawStartRef.current = null;
        return;
      }

      const now = Date.now();
      const id = `${authorRef.current}-${now}-${Math.random().toString(36).slice(2, 8)}`;
      let annotation = null;

      if (activeTool === TOOLS.arrow) {
        annotation = {
          id,
          type: 'arrow',
          data: {
            pointA: { x: startPoint3D.x, y: startPoint3D.y, z: startPoint3D.z },
            pointB: { x: endPoint3D.x, y: endPoint3D.y, z: endPoint3D.z },
          },
          color,
          author: authorRef.current,
          timestamp: now,
        };
      } else if (activeTool === TOOLS.circle) {
        const dx = e.clientX - drawStartRef.current.screenX;
        const dy = e.clientY - drawStartRef.current.screenY;
        const screenRadius = Math.sqrt(dx * dx + dy * dy);
        const worldRadius = screenRadius / ctx.rect.width * 5;
        const midPoint = startPoint3D.clone().lerp(endPoint3D, 0.5);
        const dir = endPoint3D.clone().sub(startPoint3D).normalize();
        const camDir2 = new THREE.Vector3();
        ctx.camera.getWorldDirection(camDir2);

        annotation = {
          id,
          type: 'circle',
          data: {
            position: { x: startPoint3D.x, y: startPoint3D.y, z: startPoint3D.z },
            normal: { x: camDir2.x, y: camDir2.y, z: camDir2.z },
            radius: Math.max(0.05, worldRadius),
          },
          color,
          author: authorRef.current,
          timestamp: now,
        };
      } else if (activeTool === TOOLS.freehand) {
        if (freehandPointsRef.current.length < 2) {
          drawStartRef.current = null;
          return;
        }
        const sampled = samplePoints(freehandPointsRef.current, 50);
        annotation = {
          id,
          type: 'freehand',
          data: {
            points: sampled.map((p) => ({ x: p.x, y: p.y, z: p.z })),
          },
          color,
          author: authorRef.current,
          timestamp: now,
        };
      }

      if (annotation) {
        sendAnnotation(annotation);
      }

      drawStartRef.current = null;
      freehandPointsRef.current = [];
    },
    [drawing, activeTool, color, getThreeContext]
  );

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const cursorStyle = activeTool === TOOLS.cursor
    ? 'crosshair'
    : activeTool === TOOLS.eraser
    ? 'not-allowed'
    : activeTool
    ? 'crosshair'
    : 'default';

  if (!visible) return null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={overlayRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: activeTool && activeTool !== TOOLS.eraser ? 'auto' : 'none',
          cursor: cursorStyle,
          zIndex: 10,
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          if (drawing) setDrawing(false);
        }}
      />

      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 20,
          background: 'rgba(10, 22, 40, 0.9)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(54, 207, 201, 0.3)',
          borderRadius: 8,
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <Space size={4} wrap>
          {TOOL_CONFIGS.map(({ key, icon, label }) => (
            <Tooltip title={label} key={key}>
              <Button
                size="small"
                type={activeTool === key ? 'primary' : 'default'}
                icon={icon}
                onClick={() => setActiveTool(activeTool === key ? null : key)}
              />
            </Tooltip>
          ))}
        </Space>

        {activeTool && activeTool !== TOOLS.cursor && activeTool !== TOOLS.eraser && (
          <>
            <Divider style={{ margin: '4px 0', borderColor: 'rgba(54, 207, 201, 0.2)' }} />
            <Space size={4} wrap>
              {DEFAULT_COLORS.map((c) => (
                <div
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: c,
                    border: color === c ? '2px solid #fff' : '2px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer',
                  }}
                />
              ))}
              <ColorPicker
                size="small"
                value={color}
                onChangeComplete={(val) => setColor(val.toHexString())}
              />
            </Space>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#8ba3c0' }}>Width</span>
              <Slider
                min={1}
                max={8}
                value={lineWidth}
                onChange={setLineWidth}
                style={{ width: 80, margin: 0 }}
              />
            </div>
          </>
        )}

        <Divider style={{ margin: '4px 0', borderColor: 'rgba(54, 207, 201, 0.2)' }} />
        <Space size={4}>
          <Tooltip title="Undo">
            <Button size="small" icon={<UndoOutlined />} onClick={() => sendUndo(author)} />
          </Tooltip>
          <Tooltip title="Clear All">
            <Button size="small" icon={<ClearOutlined />} danger onClick={sendClear} />
          </Tooltip>
        </Space>
      </div>
    </div>
  );
}

function samplePoints(points, maxCount) {
  if (points.length <= maxCount) return points;
  const step = (points.length - 1) / (maxCount - 1);
  const result = [];
  for (let i = 0; i < maxCount; i++) {
    const idx = Math.min(Math.round(i * step), points.length - 1);
    result.push(points[idx]);
  }
  return result;
}
