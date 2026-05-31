declare module 'jspdf-autotable' {
  interface AutoTableOptions {
    startY?: number;
    head?: any[][];
    body?: any[][];
    theme?: 'striped' | 'grid' | 'plain';
    styles?: any;
    headStyles?: any;
    bodyStyles?: any;
    columnStyles?: any;
    margin?: number | { top?: number; right?: number; bottom?: number; left?: number };
  }

  interface AutoTableResult {
    finalY: number;
  }

  export default function autoTable(doc: any, options: AutoTableOptions): AutoTableResult;
}

declare module 'onnxruntime-web' {
  export interface InferenceSession {
    run(feeds: Record<string, any>, options?: any): Promise<Record<string, any>>;
    inputNames: string[];
    outputNames: string[];
  }

  export interface TensorConstructor {
    new(type: string, data: any, dims?: number[]): Tensor;
    fromImage(image: any, options?: any): Promise<Tensor>;
  }

  export interface Tensor {
    type: string;
    dims: number[];
    data: any;
  }

  export const Tensor: TensorConstructor;

  export namespace InferenceSession {
    function create(
      path: string,
      options?: any
    ): Promise<InferenceSession>;
  }

  export const env: {
    wasm: {
      numThreads?: number;
      simd?: boolean;
      wasmPaths?: {
        'ort-wasm.wasm'?: string;
        'ort-wasm-simd.wasm'?: string;
        'ort-wasm-threaded.wasm'?: string;
      };
    };
    logLevel?: 'verbose' | 'info' | 'warning' | 'error' | 'fatal';
  };
}
