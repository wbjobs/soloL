export function temperatureToColor(
  temp: number,
  minTemp: number,
  maxTemp: number
): [number, number, number] {
  const range = maxTemp - minTemp;
  const t = range === 0 ? 0.5 : Math.max(0, Math.min(1, (temp - minTemp) / range));

  let r: number, g: number, b: number;

  if (t < 0.25) {
    const s = t / 0.25;
    r = 0;
    g = Math.round(255 * s);
    b = 255;
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    r = 0;
    g = 255;
    b = Math.round(255 * (1 - s));
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    r = Math.round(255 * s);
    g = 255;
    b = 0;
  } else {
    const s = (t - 0.75) / 0.25;
    r = 255;
    g = Math.round(255 * (1 - s));
    b = 0;
  }

  return [r, g, b];
}

export function createHeatmapImageData(
  temperatureMatrix: number[][],
  minTemp: number,
  maxTemp: number
): ImageData {
  const rows = temperatureMatrix.length;
  const cols = rows > 0 ? temperatureMatrix[0].length : 0;
  const imageData = new ImageData(cols, rows);
  const data = imageData.data;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = (y * cols + x) * 4;
      const [r, g, b] = temperatureToColor(temperatureMatrix[y][x], minTemp, maxTemp);
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 160;
    }
  }

  return imageData;
}
