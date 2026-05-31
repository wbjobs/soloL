import React, { useRef, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Billboard as DreiBillboard, Html } from '@react-three/drei';
import * as THREE from 'three';

const statusConfig = {
  online: { color: '#52c41a', text: '在线' },
  offline: { color: '#ff4d4f', text: '离线' },
  warning: { color: '#faad14', text: '警告' },
  maintenance: { color: '#1890ff', text: '维护中' },
};

const sizeConfig = {
  small: {
    cardWidth: 120,
    cardHeight: 70,
    fontSize: 10,
    titleSize: 11,
    qrSize: 24,
  },
  normal: {
    cardWidth: 180,
    cardHeight: 100,
    fontSize: 12,
    titleSize: 13,
    qrSize: 36,
  },
  large: {
    cardWidth: 240,
    cardHeight: 130,
    fontSize: 14,
    titleSize: 15,
    qrSize: 48,
  },
};

function Billboard({
  equipment,
  size = 'normal',
  onClick,
  position = [0, 2, 0],
  fadeNear = 5,
  fadeFar = 25,
}) {
  const { camera } = useThree();
  const groupRef = useRef();
  const [opacity, setOpacity] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  const hasAlerts = equipment?.alerts && equipment.alerts.length > 0;
  const status = statusConfig[equipment?.status] || statusConfig.offline;
  const config = sizeConfig[size] || sizeConfig.normal;

  useFrame(() => {
    if (!groupRef.current) return;

    const distance = camera.position.distanceTo(
      new THREE.Vector3(...groupRef.current.position.toArray())
    );

    let newOpacity = 1;
    if (distance > fadeFar) {
      newOpacity = 0;
    } else if (distance < fadeNear) {
      newOpacity = Math.max(0, (distance - 2) / (fadeNear - 2));
    } else {
      newOpacity = 1 - ((distance - fadeNear) / (fadeFar - fadeNear)) * 0.3;
    }

    setOpacity(Math.max(0, Math.min(1, newOpacity)));
  });

  if (opacity <= 0) return null;

  const handleClick = (e) => {
    e.stopPropagation();
    if (onClick) {
      onClick(equipment);
    }
  };

  return (
    <DreiBillboard ref={groupRef} position={position} follow={true}>
      <Html
        center
        transform
        zIndexRange={[100, 0]}
        style={{
          opacity,
          transition: 'opacity 0.3s ease',
          pointerEvents: opacity > 0.1 ? 'auto' : 'none',
        }}
      >
        <div
          className="billboard-card"
          onClick={handleClick}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{
            width: config.cardWidth,
            minHeight: config.cardHeight,
            padding: size === 'small' ? '6px 8px' : '10px 12px',
            cursor: 'pointer',
            transform: isHovered ? 'scale(1.05)' : 'scale(1)',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            boxShadow: isHovered
              ? '0 8px 32px rgba(54, 207, 201, 0.25)'
              : '0 4px 16px rgba(0, 0, 0, 0.3)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              background: status.color,
              opacity: 0.8,
            }}
          />

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            {size !== 'small' && equipment?.qr_code && (
              <div
                style={{
                  width: config.qrSize,
                  height: config.qrSize,
                  background: '#fff',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <img
                  src={equipment.qr_code}
                  alt="QR"
                  style={{
                    width: config.qrSize - 4,
                    height: config.qrSize - 4,
                    objectFit: 'contain',
                  }}
                />
              </div>
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: config.titleSize,
                  fontWeight: 600,
                  color: '#e0e8f0',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginBottom: 2,
                }}
              >
                {equipment?.name || 'Unknown Equipment'}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  marginBottom: size === 'small' ? 2 : 4,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: status.color,
                    boxShadow: `0 0 6px ${status.color}`,
                  }}
                />
                <span
                  style={{
                    fontSize: config.fontSize,
                    color: '#8ba3c0',
                  }}
                >
                  {status.text}
                </span>
              </div>

              {size !== 'small' && equipment?.type && (
                <div
                  style={{
                    fontSize: config.fontSize - 1,
                    color: '#5a7a9a',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {equipment.type}
                </div>
              )}
            </div>

            {hasAlerts && (
              <div
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  width: 16,
                  height: 16,
                  background: '#ff4d4f',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  boxShadow: '0 0 8px rgba(255, 77, 79, 0.6)',
                  animation: 'pulse-dot 1.5s infinite',
                }}
              >
                {equipment.alerts.length > 9 ? '!' : equipment.alerts.length}
              </div>
            )}
          </div>

          {size !== 'small' && equipment?.last_inspection && (
            <div
              style={{
                marginTop: 6,
                paddingTop: 6,
                borderTop: '1px solid rgba(54, 207, 201, 0.1)',
                fontSize: config.fontSize - 2,
                color: '#5a7a9a',
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              上次巡检: {equipment.last_inspection}
            </div>
          )}

          <div
            className="lod-indicator"
            style={{
              position: 'absolute',
              bottom: 4,
              right: 6,
              fontSize: 9,
              padding: '1px 4px',
              borderRadius: 3,
              background: 'rgba(54, 207, 201, 0.15)',
              color: '#36cfc9',
              fontFamily: "'JetBrains Mono', monospace",
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            2D
          </div>
        </div>
      </Html>
    </DreiBillboard>
  );
}

export default React.memo(Billboard);
