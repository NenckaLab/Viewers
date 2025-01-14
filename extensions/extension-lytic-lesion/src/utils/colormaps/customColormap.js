function customColormap(
  huMin,
  huMax,
  huLow,
  huHigh,
  huMid,
  windowLow,
  windowHigh
) {
  // Define the number of points in the colormap
  // const numPoints = windowHigh - windowLow;
  const numPoints = 100;
  let windowCenter = (windowHigh + windowLow) / 2;

  let huCenter = huMid;
  if (windowLow < 0) {
    windowCenter -= windowLow;
    windowHigh -= windowLow;
    huMin = huMin - windowLow;
    huCenter = huMid - windowLow;
    huLow = huLow - windowLow;
    huMid = huMid - windowLow;
    huHigh = huHigh - windowLow;
    huMax = huHigh - windowLow;
    windowLow = 0;
  }
  if (huMin < 0) {
    huCenter -= huMin;
    huMax -= huMin;
    huMin = 0;
  }
  console.log(windowLow / windowHigh);
  console.log(huMin / windowHigh);
  console.log(huLow / windowHigh);
  console.log(huCenter / windowHigh);
  console.log(huHigh / windowHigh);
  console.log(huMax / windowHigh);
  console.log(windowHigh / windowHigh);
  // Define the HU range and breakpoints
  const huG = (huCenter + huMin) / 2;
  const huB = (huCenter + huMax) / 2;
  // Define the color transitions
  let breakpoints;
  if (windowHigh - windowLow > huHigh - huLow) {
    breakpoints = [
      [0, [0, 0, 0]], // black
      [huMin / windowHigh, [96, 96, 96]], // gray
      [huLow / windowHigh, [96, 155, 96]], // green
      [huCenter / windowHigh, [255, 0, 0]], // red
      [huHigh / windowHigh, [132, 192, 255]], // blue
      [huMax / windowHigh, [192, 192, 192]], // gray
      [1, [255, 255, 255]], // white
    ];
    console.log('Window Correct');
    console.log(breakpoints);
  } else {
    breakpoints = [
      [0, [0, 0, 0]], // black
      [huMin / huMax, [32, 64, 32]], // gray
      [huLow / huMax, [64, 128, 64]], // green
      [huCenter / huMax, [255, 0, 0]], // red
      [huHigh / huMax, [128, 128, 255]], // blue
      [(huHigh + huMax) / 2 / huMax, [192, 192, 255]], // gray
      [1, [255, 255, 255]], // white
    ];
    console.log('Window Incorrect');
    console.log(breakpoints);
  }
  // Create the colormap using LinearSegmentedColormap
  const colormap = createLinearSegmentedColormap(
    'custom_colormap',
    breakpoints,
    numPoints
  );
  console.log(colormap);
  console.log(windowLow);
  console.log(huMin);
  console.log(huLow);
  console.log(huCenter);
  console.log(windowCenter);
  console.log(huHigh);
  console.log(huMax);
  console.log(windowHigh);
  // Initialize the array to store RGBPoints
  const RGBPoints = [];
  // Generate RGBPoints
  for (let i = 0; i < numPoints; i++) {
    //const value = huMin + (huMax - huMin) * (i / (numPoints - 1));
    // const normalizedValue = (value - huMin) / (huMax - huMin);
    //const normalizedValue = (value - huMin) / windowHigh;
    const normalizedValue = i / numPoints;
    const [r, g, b] = colormap[i];
    const normalizedRGB = [r / 255, g / 255, b / 255];
    RGBPoints.push(normalizedValue, ...normalizedRGB);
  }
  console.log(RGBPoints);
  return RGBPoints;
}

function createLinearSegmentedColormap(name, breakpoints, numPoints) {
  const colormap = [];

  for (let i = 0; i < numPoints; i++) {
    const value = i / (numPoints - 1);
    let color = interpolateColor(value, breakpoints);
    colormap.push(color);
  }

  return colormap;
}

function interpolateColor(value, breakpoints) {
  for (let i = 1; i < breakpoints.length; i++) {
    const [prevValue, prevColor] = breakpoints[i - 1];
    const [nextValue, nextColor] = breakpoints[i];

    if (value <= nextValue) {
      const t = (value - prevValue) / (nextValue - prevValue);
      return interpolateRGB(prevColor, nextColor, t);
    }
  }

  return breakpoints[breakpoints.length - 1][1];
}

function interpolateRGB(startColor, endColor, t) {
  const startRGB = startColor; // Removed the parseColor() function call
  const endRGB = endColor; // Removed the parseColor() function call

  const r = Math.round(startRGB[0] + (endRGB[0] - startRGB[0]) * t);
  const g = Math.round(startRGB[1] + (endRGB[1] - startRGB[1]) * t);
  const b = Math.round(startRGB[2] + (endRGB[2] - startRGB[2]) * t);

  return [r, g, b];
}

function parseColor(color) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

// Usage
const RGBPoints = customColormap();
console.log('RGBPoints =', RGBPoints);
export default customColormap;
