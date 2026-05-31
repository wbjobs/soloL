"use strict";
var _a;
const worker_threads = require("worker_threads");
const Tesseract = require("tesseract.js");
async function runOcr(imagePath) {
  const worker = await Tesseract.createWorker("eng+chi_sim");
  try {
    const result = await worker.recognize(imagePath);
    return result.data.text.trim();
  } finally {
    await worker.terminate();
  }
}
async function processTask(task) {
  var _a2, _b;
  try {
    const text = await runOcr(task.imagePath);
    (_a2 = worker_threads.parentPort) == null ? void 0 : _a2.postMessage({
      success: true,
      id: task.id,
      text
    });
  } catch (error) {
    (_b = worker_threads.parentPort) == null ? void 0 : _b.postMessage({
      success: false,
      id: task.id,
      error: String(error)
    });
  }
}
if (worker_threads.workerData && worker_threads.workerData.task) {
  processTask(worker_threads.workerData.task);
}
(_a = worker_threads.parentPort) == null ? void 0 : _a.on("message", (task) => {
  processTask(task);
});
//# sourceMappingURL=ocrWorker.js.map
