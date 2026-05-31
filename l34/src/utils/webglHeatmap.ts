const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 a_position;
out vec2 v_screenPos;

uniform vec2 u_resolution;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_screenPos = (a_position * 0.5 + 0.5) * u_resolution;
    v_screenPos.y = u_resolution.y - v_screenPos.y;
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 v_screenPos;
out vec4 fragColor;

uniform sampler2D u_tempTexture;
uniform vec4 u_boardRect;
uniform float u_minTemp;
uniform float u_maxTemp;
uniform float u_lodScale;

vec3 jetColormap(float t) {
    vec3 c;
    if (t < 0.25) {
        float s = t / 0.25;
        c = vec3(0.0, s, 1.0);
    } else if (t < 0.5) {
        float s = (t - 0.25) / 0.25;
        c = vec3(0.0, 1.0, 1.0 - s);
    } else if (t < 0.75) {
        float s = (t - 0.5) / 0.25;
        c = vec3(s, 1.0, 0.0);
    } else {
        float s = (t - 0.75) / 0.25;
        c = vec3(1.0, 1.0 - s, 0.0);
    }
    return c;
}

void main() {
    if (v_screenPos.x < u_boardRect.x ||
        v_screenPos.x > u_boardRect.x + u_boardRect.z ||
        v_screenPos.y < u_boardRect.y ||
        v_screenPos.y > u_boardRect.y + u_boardRect.w) {
        discard;
    }

    vec2 texCoord = (v_screenPos - u_boardRect.xy) / u_boardRect.zw;
    float temp = textureLod(u_tempTexture, texCoord, u_lodScale).r;

    float range = u_maxTemp - u_minTemp;
    float t = range == 0.0 ? 0.5 : clamp((temp - u_minTemp) / range, 0.0, 1.0);

    vec3 color = jetColormap(t);
    fragColor = vec4(color, 0.63);
}
`;

export class WebGLHeatmapRenderer {
    private gl: WebGL2RenderingContext;
    private program: WebGLProgram;
    private texture: WebGLTexture;
    private vao: WebGLVertexArrayObject;
    private vbo: WebGLBuffer | null;
    private floatLinear: boolean;
    private uniformLocations: {
        u_resolution: WebGLUniformLocation | null;
        u_boardRect: WebGLUniformLocation | null;
        u_minTemp: WebGLUniformLocation | null;
        u_maxTemp: WebGLUniformLocation | null;
        u_lodScale: WebGLUniformLocation | null;
        u_tempTexture: WebGLUniformLocation | null;
    };

    constructor(canvas: HTMLCanvasElement) {
        const gl = canvas.getContext('webgl2', {
            alpha: true,
            premultipliedAlpha: false,
            preserveDrawingBuffer: false,
        });
        if (!gl) throw new Error('WebGL2 not available');
        this.gl = gl;

        this.floatLinear = !!gl.getExtension('OES_texture_float_linear');

        const vs = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
        const fs = this.compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
        this.program = this.linkProgram(vs, fs);
        gl.deleteShader(vs);
        gl.deleteShader(fs);

        this.texture = this.initTexture();
        const quad = this.initQuad();
        this.vao = quad.vao;
        this.vbo = quad.vbo;
        this.uniformLocations = this.cacheUniforms();

        gl.useProgram(this.program);
        gl.uniform1i(this.uniformLocations.u_tempTexture, 0);
    }

    private compileShader(type: number, source: string): WebGLShader {
        const gl = this.gl;
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Failed to create shader');
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`Shader compile error: ${info}`);
        }
        return shader;
    }

    private linkProgram(vs: WebGLShader, fs: WebGLShader): WebGLProgram {
        const gl = this.gl;
        const program = gl.createProgram();
        if (!program) throw new Error('Failed to create program');
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const info = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error(`Program link error: ${info}`);
        }
        return program;
    }

    private initTexture(): WebGLTexture {
        const gl = this.gl;
        const texture = gl.createTexture();
        if (!texture) throw new Error('Failed to create texture');
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(
            gl.TEXTURE_2D, 0, gl.R32F,
            1, 1, 0,
            gl.RED, gl.FLOAT,
            new Float32Array([0]),
        );
        this.applyTextureFilters();
        return texture;
    }

    private applyTextureFilters(): void {
        const gl = this.gl;
        if (this.floatLinear) {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        } else {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    private initQuad(): { vao: WebGLVertexArrayObject; vbo: WebGLBuffer | null } {
        const gl = this.gl;
        const vao = gl.createVertexArray();
        if (!vao) throw new Error('Failed to create VAO');
        gl.bindVertexArray(vao);

        const positions = new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
             1,  1,
        ]);

        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        const posLoc = gl.getAttribLocation(this.program, 'a_position');
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.bindVertexArray(null);
        return { vao, vbo };
    }

    private cacheUniforms() {
        const gl = this.gl;
        return {
            u_resolution: gl.getUniformLocation(this.program, 'u_resolution'),
            u_boardRect: gl.getUniformLocation(this.program, 'u_boardRect'),
            u_minTemp: gl.getUniformLocation(this.program, 'u_minTemp'),
            u_maxTemp: gl.getUniformLocation(this.program, 'u_maxTemp'),
            u_lodScale: gl.getUniformLocation(this.program, 'u_lodScale'),
            u_tempTexture: gl.getUniformLocation(this.program, 'u_tempTexture'),
        };
    }

    updateTemperatureData(temperatureMatrix: number[][], gridRows: number, gridCols: number): void {
        if (gridRows <= 0 || gridCols <= 0) return;

        const gl = this.gl;
        const flat = new Float32Array(gridRows * gridCols);
        for (let y = 0; y < gridRows; y++) {
            for (let x = 0; x < gridCols; x++) {
                flat[y * gridCols + x] = temperatureMatrix[y][x];
            }
        }

        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(
            gl.TEXTURE_2D, 0, gl.R32F,
            gridCols, gridRows, 0,
            gl.RED, gl.FLOAT,
            flat,
        );
        gl.generateMipmap(gl.TEXTURE_2D);
        this.applyTextureFilters();
    }

    render(
        boardX: number,
        boardY: number,
        boardW: number,
        boardH: number,
        canvasW: number,
        canvasH: number,
        zoom: number,
        minTemp: number,
        maxTemp: number,
    ): void {
        const gl = this.gl;
        const dpr = window.devicePixelRatio || 1;
        const physW = Math.round(canvasW * dpr);
        const physH = Math.round(canvasH * dpr);

        const canvas = gl.canvas as HTMLCanvasElement;
        if (canvas.width !== physW || canvas.height !== physH) {
            canvas.width = physW;
            canvas.height = physH;
        }

        gl.viewport(0, 0, physW, physH);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.useProgram(this.program);

        gl.uniform2f(this.uniformLocations.u_resolution, physW, physH);
        gl.uniform4f(
            this.uniformLocations.u_boardRect,
            boardX * dpr, boardY * dpr,
            boardW * dpr, boardH * dpr,
        );
        gl.uniform1f(this.uniformLocations.u_minTemp, minTemp);
        gl.uniform1f(this.uniformLocations.u_maxTemp, maxTemp);

        const lodScale = Math.max(0, Math.log2(1 / zoom));
        gl.uniform1f(this.uniformLocations.u_lodScale, lodScale);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);

        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    dispose(): void {
        const gl = this.gl;
        gl.deleteTexture(this.texture);
        gl.deleteProgram(this.program);
        gl.deleteVertexArray(this.vao);
        if (this.vbo) gl.deleteBuffer(this.vbo);
    }
}

export function createWebGLHeatmapRenderer(canvas: HTMLCanvasElement): WebGLHeatmapRenderer | null {
    try {
        return new WebGLHeatmapRenderer(canvas);
    } catch {
        return null;
    }
}
