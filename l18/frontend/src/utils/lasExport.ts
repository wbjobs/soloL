const calculateBounds = (points: Float32Array) => {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    minX = Math.min(minX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    minZ = Math.min(minZ, points[i + 2]);
    maxX = Math.max(maxX, points[i]);
    maxY = Math.max(maxY, points[i + 1]);
    maxZ = Math.max(maxZ, points[i + 2]);
  }
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
};

export const exportToLAS = (
  points: Float32Array,
  colors: Float32Array | null,
  labels: Uint32Array | null
): Uint8Array => {
  const pointCount = points.length / 3;
  const pointDataRecordLength = 28;
  const headerSize = 227;
  const totalSize = headerSize + pointCount * pointDataRecordLength;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  view.setUint8(0, 0x4C);
  view.setUint8(1, 0x41);
  view.setUint8(2, 0x53);
  view.setUint8(3, 0x46);
  view.setUint16(4, 1200, true);
  view.setUint16(6, 0, true);
  view.setUint32(90, pointCount, true);

  const { min, max } = calculateBounds(points);
  const scale = 0.001;
  const offsetX = -min.x / scale;
  const offsetY = -min.y / scale;
  const offsetZ = -min.z / scale;

  view.setFloat64(96, scale, true);
  view.setFloat64(104, scale, true);
  view.setFloat64(112, scale, true);
  view.setFloat64(120, offsetX, true);
  view.setFloat64(128, offsetY, true);
  view.setFloat64(136, offsetZ, true);
  view.setFloat64(144, max.x, true);
  view.setFloat64(152, max.y, true);
  view.setFloat64(160, max.z, true);
  view.setFloat64(168, min.x, true);
  view.setFloat64(176, min.y, true);
  view.setFloat64(184, min.z, true);

  for (let i = 0; i < pointCount; i++) {
    const base = headerSize + i * pointDataRecordLength;
    view.setInt32(base, Math.round((points[i * 3] + offsetX) / scale), true);
    view.setInt32(base + 4, Math.round((points[i * 3 + 1] + offsetY) / scale), true);
    view.setInt32(base + 8, Math.round((points[i * 3 + 2] + offsetZ) / scale), true);

    if (colors) {
      view.setUint16(base + 14, Math.round(colors[i * 3] * 65535), true);
      view.setUint16(base + 16, Math.round(colors[i * 3 + 1] * 65535), true);
      view.setUint16(base + 18, Math.round(colors[i * 3 + 2] * 65535), true);
    }
    if (labels) view.setUint8(base + 20, labels[i] & 0xFF);
  }

  return new Uint8Array(buffer);
};
