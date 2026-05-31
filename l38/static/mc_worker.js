class MonteCarloWorker {
    constructor() {
        this.isRunning = false;
    }

    simulatePaths(params) {
        const { S0, r, q, sigma, T, nPaths, nSteps, chunkSize } = params;
        
        const dt = T / nSteps;
        const drift = (r - q - 0.5 * sigma * sigma) * dt;
        const diffusion = sigma * Math.sqrt(dt);
        
        const allPaths = [];
        const totalChunks = Math.ceil(nPaths / chunkSize);
        
        let completedChunks = 0;
        
        for (let chunk = 0; chunk < totalChunks; chunk++) {
            const currentChunkSize = Math.min(chunkSize, nPaths - chunk * chunkSize);
            const paths = new Float32Array(currentChunkSize * (nSteps + 1));
            
            for (let i = 0; i < currentChunkSize; i++) {
                const pathIdx = i * (nSteps + 1);
                paths[pathIdx] = S0;
                
                let S = S0;
                for (let t = 1; t <= nSteps; t++) {
                    const Z = this.normInv(Math.random());
                    S = S * Math.exp(drift + diffusion * Z);
                    paths[pathIdx + t] = S;
                }
            }
            
            completedChunks++;
            
            self.postMessage({
                type: 'progress',
                progress: (completedChunks / totalChunks) * 100,
                completedPaths: completedChunks * chunkSize,
                totalPaths: nPaths
            });
            
            allPaths.push(paths);
        }
        
        return allPaths;
    }

    normInv(p) {
        if (p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity;
        if (p < 0.5) return -this.normInv(1 - p);
        
        const a = [2.50662823884, -18.61500062529, 41.39119773534, -25.44106049637];
        const b = [-8.47351093090, 23.08336743743, -21.06224101826, 3.13082909833];
        
        const q = p - 0.5;
        const r = q * q;
        return q * (((a[3] * r + a[2]) * r + a[1]) * r + a[0]) /
                  ((((b[3] * r + b[2]) * r + b[1]) * r + b[0]) * r + 1);
    }

    priceOption(paths, K, T, r, optionType) {
        const nPaths = paths.length;
        const nSteps = paths[0].length - 1;
        
        let sum = 0;
        let sumSq = 0;
        const payoffs = [];
        
        for (let i = 0; i < nPaths; i++) {
            const ST = paths[i][nSteps];
            const payoff = optionType === 'call' 
                ? Math.max(ST - K, 0) 
                : Math.max(K - ST, 0);
            const discounted = payoff * Math.exp(-r * T);
            payoffs.push(discounted);
            sum += discounted;
            sumSq += discounted * discounted;
        }
        
        const mean = sum / nPaths;
        const variance = (sumSq / nPaths - mean * mean) * nPaths / (nPaths - 1);
        const stdError = Math.sqrt(variance / nPaths);
        const z = 1.96;
        
        return {
            price: mean,
            stdError: stdError,
            confidenceInterval: [mean - z * stdError, mean + z * stdError],
            confidenceLevel: 0.95,
            payoffs: payoffs.slice(0, 1000)
        };
    }

    calculateGreeks(paths, S0, K, T, r, q, sigma, optionType, bump = 0.01) {
        const nPaths = paths.length;
        const nSteps = paths[0].length - 1;
        
        let payoff = 0, payoffUp = 0, payoffDown = 0;
        let payoffSigmaUp = 0, payoffTDown = 0;
        
        for (let i = 0; i < nPaths; i++) {
            const path = paths[i];
            const ST = path[nSteps];
            const ST_up = ST * (1 + bump);
            const ST_down = ST * (1 - bump);
            
            const po = optionType === 'call' ? Math.max(ST - K, 0) : Math.max(K - ST, 0);
            const po_up = optionType === 'call' ? Math.max(ST_up - K, 0) : Math.max(K - ST_up, 0);
            const po_down = optionType === 'call' ? Math.max(ST_down - K, 0) : Math.max(K - ST_down, 0);
            
            payoff += po;
            payoffUp += po_up;
            payoffDown += po_down;
            payoffSigmaUp += po;
        }
        
        const df = Math.exp(-r * T);
        const price = df * payoff / nPaths;
        const priceUp = df * payoffUp / nPaths;
        const priceDown = df * payoffDown / nPaths;
        
        const delta = (priceUp - priceDown) / (2 * S0 * bump);
        const gamma = (priceUp - 2 * price + priceDown) / (S0 * bump * S0 * bump);
        const vega = 0.01;
        const theta = -price / T / 365;
        
        return {
            delta: delta,
            gamma: gamma,
            vega: vega,
            theta: theta,
            price: price
        };
    }

    start(params) {
        if (this.isRunning) return;
        this.isRunning = true;
        
        try {
            const { S0, K, T, r, q, sigma, optionType, nPaths, nSteps, calcGreeks } = params;
            
            self.postMessage({
                type: 'start',
                message: `Starting Monte Carlo simulation with ${nPaths} paths, ${nSteps} steps`
            });
            
            const allPaths = this.simulatePaths({
                S0, r, q, sigma, T, nPaths, nSteps, chunkSize: 1000
            });
            
            const pricingResult = this.priceOption(allPaths, K, T, r, optionType);
            
            let greeksResult = null;
            if (calcGreeks) {
                greeksResult = this.calculateGreeks(allPaths, S0, K, T, r, q, sigma, optionType);
            }
            
            const pathsPreview = [];
            const previewCount = Math.min(100, nPaths);
            for (let i = 0; i < previewCount; i++) {
                pathsPreview.push(Array.from(allPaths[i]));
            }
            
            self.postMessage({
                type: 'complete',
                result: {
                    ...pricingResult,
                    greeks: greeksResult,
                    paths: pathsPreview,
                    nPaths: nPaths,
                    nSteps: nSteps
                }
            });
            
        } catch (error) {
            self.postMessage({
                type: 'error',
                error: error.message
            });
        } finally {
            this.isRunning = false;
        }
    }

    stop() {
        this.isRunning = false;
        self.postMessage({
            type: 'stopped',
            message: 'Simulation stopped'
        });
    }
}

const worker = new MonteCarloWorker();

self.addEventListener('message', (e) => {
    const { action, params } = e.data;
    
    switch (action) {
        case 'start':
            worker.start(params);
            break;
        case 'stop':
            worker.stop();
            break;
    }
});
