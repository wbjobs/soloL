import FingerprintModule from './fingerprint'

interface FingerprintModuleType {
  _malloc: (size: number) => number
  _free: (ptr: number) => void
  _free_fingerprint_result: (ptr: number) => void
  HEAPF32: Float32Array
  HEAPU8: Uint8Array
  _extract_fingerprint: (audioPtr: number, audioLen: number, outLenPtr: number) => number
  _hamming_distance: (aPtr: number, bPtr: number, length: number) => number
}

let moduleInstance: FingerprintModuleType | null = null

export async function initWasm(): Promise<void> {
  if (!moduleInstance) {
    moduleInstance = await FingerprintModule()
  }
}

export function isWasmReady(): boolean {
  return moduleInstance !== null
}

export function extractFingerprint(audioData: Float32Array): Uint8Array {
  if (!moduleInstance) {
    throw new Error('WASM module not initialized')
  }

  const audioPtr = moduleInstance._malloc(audioData.length * 4)
  const outLenPtr = moduleInstance._malloc(4)
  let fingerprintPtr = 0

  try {
    moduleInstance.HEAPF32.set(audioData, audioPtr / 4)

    fingerprintPtr = moduleInstance._extract_fingerprint(audioPtr, audioData.length, outLenPtr)
    const outLen = new Int32Array(moduleInstance.HEAPU8.buffer, outLenPtr, 1)[0]

    const fingerprint = new Uint8Array(outLen)
    fingerprint.set(moduleInstance.HEAPU8.subarray(fingerprintPtr, fingerprintPtr + outLen))

    return fingerprint
  } finally {
    if (fingerprintPtr) {
      moduleInstance._free_fingerprint_result(fingerprintPtr)
    }
    moduleInstance._free(audioPtr)
    moduleInstance._free(outLenPtr)
  }
}

export function hammingDistance(a: Uint8Array, b: Uint8Array): number {
  if (!moduleInstance) {
    throw new Error('WASM module not initialized')
  }

  if (a.length !== b.length) {
    throw new Error('Fingerprints must have the same length')
  }

  const aPtr = moduleInstance._malloc(a.length)
  const bPtr = moduleInstance._malloc(b.length)

  try {
    moduleInstance.HEAPU8.set(a, aPtr)
    moduleInstance.HEAPU8.set(b, bPtr)

    return moduleInstance._hamming_distance(aPtr, bPtr, a.length)
  } finally {
    moduleInstance._free(aPtr)
    moduleInstance._free(bPtr)
  }
}

export function fingerprintToHex(fingerprint: Uint8Array): string {
  return Array.from(fingerprint)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export function hexToFingerprint(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}
