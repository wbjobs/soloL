const assert = require('assert');
const DataCleaner = require('../src/dataCleaner');
const DataAggregator = require('../src/dataAggregator');
const AOIAnalyzer = require('../src/aoiAnalyzer');

console.log('='.repeat(60));
console.log('Eye Tracker Platform - Module Tests');
console.log('='.repeat(60));
console.log('');

let testsPassed = 0;
let testsFailed = 0;
let testQueue = [];

function test(name, fn) {
    testQueue.push({ name, fn });
}

async function runTests() {
    for (const { name, fn } of testQueue) {
        try {
            if (fn.length > 0) {
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Test timed out after 2000ms'));
                    }, 2000);
                    
                    fn((err) => {
                        clearTimeout(timeout);
                        if (err) reject(err);
                        else resolve();
                    });
                });
            } else {
                const result = fn();
                if (result && typeof result.then === 'function') {
                    await result;
                }
            }
            console.log(`  ✓ ${name}`);
            testsPassed++;
        } catch (err) {
            console.log(`  ✗ ${name}`);
            console.log(`    Error: ${err.message}`);
            testsFailed++;
        }
    }
    
    console.log('');
    console.log('='.repeat(60));
    console.log(`Tests Complete: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('='.repeat(60));
    
    if (testsFailed > 0) {
        process.exit(1);
    }
}

console.log('1. DataCleaner Tests');
console.log('-'.repeat(40));

const cleaner = new DataCleaner();

test('should clean valid data point', () => {
    const result = cleaner.clean({
        x: 500, y: 300, pupilDiameter: 3.5, timestamp: Date.now()
    });
    assert(result !== null);
    assert.strictEqual(result.x, 500);
    assert.strictEqual(result.y, 300);
    assert.strictEqual(result.pupilDiameter, 3.5);
});

test('should filter invalid pupil diameter (< 0.2mm)', () => {
    const result = cleaner.clean({
        x: 500, y: 300, pupilDiameter: 0.1, timestamp: Date.now()
    });
    assert.strictEqual(result, null);
});

test('should filter out of bounds coordinates', () => {
    const result = cleaner.clean({
        x: 3000, y: 300, pupilDiameter: 3.5, timestamp: Date.now()
    });
    assert.strictEqual(result, null);
});

test('should filter negative coordinates', () => {
    const result = cleaner.clean({
        x: -100, y: 300, pupilDiameter: 3.5, timestamp: Date.now()
    });
    assert.strictEqual(result, null);
});

test('should filter invalid data structure', () => {
    const result = cleaner.clean({ x: 'invalid', y: 300, pupilDiameter: 3.5 });
    assert.strictEqual(result, null);
});

test('should filter missing fields', () => {
    const result = cleaner.clean({ x: 500, y: 300 });
    assert.strictEqual(result, null);
});

test('should clean batch of data points', () => {
    const points = [
        { x: 500, y: 300, pupilDiameter: 3.5 },
        { x: 100, y: 200, pupilDiameter: 0.1 },
        { x: 200, y: 400, pupilDiameter: 4.0 },
        { x: 3000, y: 300, pupilDiameter: 3.5 },
        { x: 150, y: 250, pupilDiameter: 3.0 }
    ];
    const result = cleaner.cleanBatch(points);
    assert.strictEqual(result.length, 3);
});

console.log('');
console.log('2. DataAggregator Tests');
console.log('-'.repeat(40));

const aggregator = new DataAggregator();
aggregator.start();

test('should aggregate multiple points correctly', () => {
    const points = [
        { x: 100, y: 100, pupilDiameter: 3.0, timestamp: Date.now() },
        { x: 102, y: 102, pupilDiameter: 3.2, timestamp: Date.now() },
        { x: 98, y: 98, pupilDiameter: 2.8, timestamp: Date.now() }
    ];
    
    const aggregated = aggregator.aggregatePoints(points);
    
    assert.strictEqual(aggregated.count, 3);
    assert(Math.abs(aggregated.x - 100) < 1);
    assert(Math.abs(aggregated.y - 100) < 1);
    assert(Math.abs(aggregated.pupilDiameter - 3.0) < 0.1);
    assert(aggregated.stdDevX >= 0);
    assert(aggregated.stdDevY >= 0);
    assert.strictEqual(aggregated.minX, 98);
    assert.strictEqual(aggregated.maxX, 102);
});

test('should handle single point aggregation', () => {
    const point = { x: 500, y: 500, pupilDiameter: 3.5, timestamp: Date.now() };
    const aggregated = aggregator.aggregatePoints([point]);
    
    assert.strictEqual(aggregated.count, 1);
    assert.strictEqual(aggregated.x, 500);
    assert.strictEqual(aggregated.y, 500);
    assert.strictEqual(aggregated.pupilDiameter, 3.5);
});

test('should buffer data points', () => {
    const testAggregator = new DataAggregator();
    testAggregator.running = true;
    const initialSize = testAggregator.getBufferSize();
    testAggregator.addDataPoint({ x: 100, y: 100, pupilDiameter: 3.0, timestamp: Date.now() });
    assert.strictEqual(testAggregator.getBufferSize(), initialSize + 1);
    testAggregator.running = false;
});

test('should add batch of points', () => {
    const testAggregator = new DataAggregator();
    testAggregator.running = true;
    const initialSize = testAggregator.getBufferSize();
    const points = [
        { x: 100, y: 100, pupilDiameter: 3.0, timestamp: Date.now() },
        { x: 200, y: 200, pupilDiameter: 3.5, timestamp: Date.now() }
    ];
    testAggregator.addBatch(points);
    assert.strictEqual(testAggregator.getBufferSize(), initialSize + 2);
    testAggregator.running = false;
});

aggregator.stop();

console.log('');
console.log('3. AOIAnalyzer Tests');
console.log('-'.repeat(40));

const analyzer = new AOIAnalyzer();

const testAOIs = [
    {
        id: 'aoi1',
        name: 'Test Rectangle',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 200,
        height: 150
    },
    {
        id: 'aoi2',
        name: 'Test Circle',
        type: 'circle',
        x: 500,
        y: 300,
        radius: 100
    }
];

test('should detect point inside rectangle AOI', () => {
    const point = { x: 150, y: 150, pupilDiameter: 3.0 };
    assert(analyzer.isPointInAOI(point, testAOIs[0]));
});

test('should detect point outside rectangle AOI', () => {
    const point = { x: 50, y: 150, pupilDiameter: 3.0 };
    assert(!analyzer.isPointInAOI(point, testAOIs[0]));
});

test('should detect point inside circle AOI', () => {
    const point = { x: 550, y: 300, pupilDiameter: 3.0 };
    assert(analyzer.isPointInAOI(point, testAOIs[1]));
});

test('should detect point outside circle AOI', () => {
    const point = { x: 700, y: 300, pupilDiameter: 3.0 };
    assert(!analyzer.isPointInAOI(point, testAOIs[1]));
});

test('should analyze AOI metrics correctly', () => {
    const now = Date.now();
    const dataPoints = [
        { x: 150, y: 150, pupilDiameter: 3.0, timestamp: now },
        { x: 160, y: 160, pupilDiameter: 3.1, timestamp: now + 10 },
        { x: 170, y: 170, pupilDiameter: 3.2, timestamp: now + 20 },
        { x: 400, y: 400, pupilDiameter: 3.3, timestamp: now + 30 },
        { x: 180, y: 180, pupilDiameter: 3.4, timestamp: now + 40 },
        { x: 190, y: 190, pupilDiameter: 3.5, timestamp: now + 50 }
    ];

    const result = analyzer.analyzeSingleAOI(dataPoints, testAOIs[0]);
    
    assert.strictEqual(result.aoiId, 'aoi1');
    assert(result.firstEntryTime === now);
    assert(result.totalDuration > 0);
    assert.strictEqual(result.revisitCount, 1);
    assert.strictEqual(result.totalFixations, 2);
    assert(result.pointsInsideCount === 5);
    assert(result.dwellTimePercentage > 50);
    assert(result.pupilDiameterAvg > 3);
});

test('should generate scan path', () => {
    const now = Date.now();
    const dataPoints = [
        { x: 150, y: 150, pupilDiameter: 3.0, timestamp: now },
        { x: 550, y: 300, pupilDiameter: 3.0, timestamp: now + 100 },
        { x: 150, y: 150, pupilDiameter: 3.0, timestamp: now + 200 }
    ];

    const scanPath = analyzer.generateScanPath(dataPoints, testAOIs);
    assert(scanPath.length >= 2);
    assert(scanPath[0].aoiId === 'aoi1');
    assert(scanPath[1].aoiId === 'aoi2');
});

test('should calculate transition matrix', () => {
    const now = Date.now();
    const dataPoints = [
        { x: 150, y: 150, pupilDiameter: 3.0, timestamp: now },
        { x: 550, y: 300, pupilDiameter: 3.0, timestamp: now + 100 },
        { x: 150, y: 150, pupilDiameter: 3.0, timestamp: now + 200 },
        { x: 550, y: 300, pupilDiameter: 3.0, timestamp: now + 300 }
    ];

    const matrix = analyzer.calculateTransitionMatrix(dataPoints, testAOIs);
    assert(matrix['aoi1']['aoi2'] >= 1);
    assert(matrix['aoi2']['aoi1'] >= 1);
});

test('should handle polygon AOI', () => {
    const polygonAOI = {
        id: 'poly1',
        name: 'Polygon',
        type: 'polygon',
        points: [
            { x: 100, y: 100 },
            { x: 300, y: 100 },
            { x: 300, y: 300 },
            { x: 100, y: 300 }
        ]
    };
    
    const inside = { x: 200, y: 200, pupilDiameter: 3.0 };
    const outside = { x: 400, y: 200, pupilDiameter: 3.0 };
    
    assert(analyzer.isPointInAOI(inside, polygonAOI));
    assert(!analyzer.isPointInAOI(outside, polygonAOI));
});

test('should analyze multiple AOIs', () => {
    const now = Date.now();
    const dataPoints = [
        { x: 150, y: 150, pupilDiameter: 3.0, timestamp: now },
        { x: 550, y: 300, pupilDiameter: 3.0, timestamp: now + 100 }
    ];

    const results = analyzer.analyze(dataPoints, testAOIs);
    assert('aoi1' in results);
    assert('aoi2' in results);
    assert(results['aoi1'].pointsInsideCount === 1);
    assert(results['aoi2'].pointsInsideCount === 1);
});

console.log('');
console.log('4. UDP Message Parsing Tests');
console.log('-'.repeat(40));

const UDPServer = require('../src/udpServer');
const udpServer = new UDPServer();

test('should parse JSON message', () => {
    const jsonMsg = Buffer.from(JSON.stringify({ x: 500, y: 300, pupilDiameter: 3.5, timestamp: Date.now() }));
    const result = udpServer.parseMessage(jsonMsg);
    assert.strictEqual(result.x, 500);
    assert.strictEqual(result.pupilDiameter, 3.5);
});

test('should parse array format', () => {
    const arrMsg = Buffer.from(JSON.stringify([500, 300, 3.5, Date.now()]));
    const result = udpServer.parseMessage(arrMsg);
    assert.strictEqual(result.x, 500);
    assert.strictEqual(result.y, 300);
    assert.strictEqual(result.pupilDiameter, 3.5);
});

test('should parse CSV format', () => {
    const csvMsg = Buffer.from('500, 300, 3.5');
    const result = udpServer.parseMessage(csvMsg);
    assert.strictEqual(result.x, 500);
    assert.strictEqual(result.y, 300);
    assert.strictEqual(result.pupilDiameter, 3.5);
});

test('should parse tab-delimited format', () => {
    const tabMsg = Buffer.from('500\t300\t3.5');
    const result = udpServer.parseMessage(tabMsg);
    assert.strictEqual(result.x, 500);
    assert.strictEqual(result.y, 300);
    assert.strictEqual(result.pupilDiameter, 3.5);
});

console.log('');
console.log('5. Packet Reorderer Tests');
console.log('-'.repeat(40));

const PacketReorderer = require('../src/packetReorderer');

test('should reorder out-of-order packets', (done) => {
    const reorderer = new PacketReorderer({
        windowSizeMs: 50,
        maxWindowSize: 10,
        timeoutDiscardMs: 200
    });
    
    const received = [];
    reorderer.on('data', (data) => {
        received.push(data);
    });
    
    reorderer.start();
    
    const now = Date.now();
    const packets = [
        { x: 100, y: 100, pupilDiameter: 3.0, timestamp: now },
        { x: 300, y: 300, pupilDiameter: 3.2, timestamp: now + 8 },
        { x: 200, y: 200, pupilDiameter: 3.1, timestamp: now + 4 },
        { x: 400, y: 400, pupilDiameter: 3.3, timestamp: now + 12 },
    ];
    
    packets.forEach(p => reorderer.addPacket(p));
    
    setTimeout(() => {
        reorderer.stop();
        assert(received.length >= 4, `Should have received 4 packets, got ${received.length}`);
        
        for (let i = 1; i < received.length; i++) {
            assert(received[i].timestamp >= received[i-1].timestamp, 
                `Packets should be in order: ${received[i-1].timestamp} <= ${received[i].timestamp}`);
        }
        
        assert(received[0].x === 100, 'First packet should be x=100');
        assert(received[1].x === 200, 'Second packet should be x=200 (reordered)');
        assert(received[2].x === 300, 'Third packet should be x=300');
        done();
    }, 150);
});

test('should find correct insert index using binary search', () => {
    const reorderer = new PacketReorderer();
    reorderer.start();
    
    const now = Date.now();
    reorderer.buffer = [
        { timestamp: now },
        { timestamp: now + 10 },
        { timestamp: now + 20 },
        { timestamp: now + 30 }
    ];
    
    let index = reorderer.findInsertIndex(now + 5);
    assert.strictEqual(index, 1);
    
    index = reorderer.findInsertIndex(now - 5);
    assert.strictEqual(index, 0);
    
    index = reorderer.findInsertIndex(now + 35);
    assert.strictEqual(index, 4);
    
    index = reorderer.findInsertIndex(now + 20);
    assert.strictEqual(index, 2);
    
    reorderer.stop();
});

test('should discard packets older than timeout', (done) => {
    const reorderer = new PacketReorderer({
        windowSizeMs: 20,
        maxWindowSize: 100,
        timeoutDiscardMs: 50
    });
    
    let discardedCount = 0;
    reorderer.on('discarded', () => {
        discardedCount++;
    });
    
    reorderer.start();
    
    const oldPacket = { x: 100, y: 100, pupilDiameter: 3.0, timestamp: Date.now() - 100 };
    reorderer.addPacket(oldPacket);
    
    setTimeout(() => {
        reorderer.stop();
        assert(discardedCount >= 1, `Should have discarded 1 packet, got ${discardedCount}`);
        done();
    }, 100);
});

test('should emit data in correct order with severe out-of-order', (done) => {
    const reorderer = new PacketReorderer({
        windowSizeMs: 80,
        maxWindowSize: 20,
        timeoutDiscardMs: 200
    });
    
    const receivedTimestamps = [];
    reorderer.on('data', (data) => {
        receivedTimestamps.push(data.timestamp);
    });
    
    reorderer.start();
    
    const now = Date.now();
    const timestamps = [0, 20, 40, 60, 80, 100];
    const shuffled = [40, 0, 80, 20, 100, 60];
    
    shuffled.forEach((offset, i) => {
        setTimeout(() => {
            reorderer.addPacket({ 
                x: offset, 
                y: offset, 
                pupilDiameter: 3.0, 
                timestamp: now + offset 
            });
        }, i * 5);
    });
    
    setTimeout(() => {
        reorderer.stop();
        assert(receivedTimestamps.length >= 6, `Should have 6 packets, got ${receivedTimestamps.length}`);
        
        const sorted = [...receivedTimestamps].sort((a, b) => a - b);
        assert.deepStrictEqual(receivedTimestamps, sorted, 'Timestamps should be in ascending order');
        
        done();
    }, 250);
});

test('should return correct stats', () => {
    const reorderer = new PacketReorderer();
    reorderer.start();
    
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
        reorderer.addPacket({ x: i, y: i, pupilDiameter: 3.0, timestamp: now + i });
    }
    
    const stats = reorderer.getStats();
    assert.strictEqual(stats.totalReceived, 5);
    assert(stats.isRunning === true);
    assert(stats.bufferSize >= 0);
    
    reorderer.stop();
    
    const stats2 = reorderer.getStats();
    assert(stats2.isRunning === false);
    assert(stats2.totalEmitted === 5);
});

test('should flush all packets when stopped', () => {
    const reorderer = new PacketReorderer({
        windowSizeMs: 500,
        maxWindowSize: 100,
        timeoutDiscardMs: 1000
    });
    
    const received = [];
    reorderer.on('data', (data) => {
        received.push(data);
    });
    
    reorderer.start();
    
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
        reorderer.addPacket({ x: i, y: i, pupilDiameter: 3.0, timestamp: now + i * 10 });
    }
    
    assert(received.length === 0, 'Should not have emitted before stop');
    
    reorderer.stop();
    
    assert(received.length === 5, `Should have flushed all 5 packets, got ${received.length}`);
});

console.log('');
console.log('6. PrefixSpan Tests');
console.log('-'.repeat(40));

const PrefixSpan = require('../src/prefixSpan');

test('should mine frequent sequences from simple data', () => {
    const miner = new PrefixSpan({ minSupport: 0.5, minPatternLength: 2 });
    const sequences = [
        ['A', 'B', 'C'],
        ['A', 'B', 'D'],
        ['A', 'C', 'B'],
        ['B', 'C', 'D']
    ];
    
    const result = miner.mine(sequences);
    
    assert(result.patterns.length > 0, 'Should find patterns');
    assert(result.stats.totalSequences === 4, 'Should have 4 total sequences');
    
    const abPattern = result.patterns.find(p => p.pattern.length === 2 && p.pattern[0] === 'A' && p.pattern[1] === 'B');
    assert(abPattern, 'Should find A->B pattern');
    assert(abPattern.support === 3, 'A->B should have support 3 (subsequence match)');
    assert(abPattern.supportRate === 0.75, 'A->B support rate should be 0.75');
});

test('should respect minimum support threshold', () => {
    const miner = new PrefixSpan({ minSupport: 0.8, minPatternLength: 2 });
    const sequences = [
        ['A', 'B'],
        ['A', 'B'],
        ['A', 'C'],
        ['D', 'E']
    ];
    
    const result = miner.mine(sequences);
    
    result.patterns.forEach(p => {
        assert(p.supportRate >= 0.8, `Pattern ${p.pattern.join('->')} support ${p.supportRate} should be >= 0.8`);
    });
});

test('should compress consecutive duplicate items', () => {
    const miner = new PrefixSpan();
    const compressed = miner.compressSequence(['A', 'A', 'B', 'B', 'B', 'A']);
    
    assert.deepStrictEqual(compressed, ['A', 'B', 'A']);
});

test('should build sequences from scan path', () => {
    const miner = new PrefixSpan();
    const now = Date.now();
    const scanPath = [
        { aoiId: 'A', aoiName: 'Area A', timestamp: now },
        { aoiId: 'B', aoiName: 'Area B', timestamp: now + 100 },
        { aoiId: 'A', aoiName: 'Area A', timestamp: now + 200 },
        { aoiId: 'C', aoiName: 'Area C', timestamp: now + 10000 }
    ];
    
    const sequences = miner.buildSequencesFromScanPath(scanPath, 5000);
    
    assert(sequences.length >= 1, 'Should build at least 1 sequence');
    assert.deepStrictEqual(sequences[0], ['A', 'B', 'A']);
});

test('should generate sankey data from patterns', () => {
    const miner = new PrefixSpan();
    const patterns = [
        { pattern: ['A', 'B'], support: 5, supportRate: 0.5, length: 2 },
        { pattern: ['A', 'B', 'C'], support: 3, supportRate: 0.3, length: 3 }
    ];
    const aoiMap = { A: 'Area A', B: 'Area B', C: 'Area C' };
    
    const sankeyData = miner.generateSankeyData(patterns, aoiMap);
    
    assert(sankeyData.nodes.length > 0, 'Should have nodes');
    assert(sankeyData.links.length > 0, 'Should have links');
    
    const abLink = sankeyData.links.find(l => l.sourceAOI === 'A' && l.targetAOI === 'B');
    assert(abLink, 'Should have A->B link');
    assert.strictEqual(abLink.value, 8);
});

test('should handle empty sequences', () => {
    const miner = new PrefixSpan({ minSupport: 0.5 });
    const result = miner.mine([]);
    
    assert.strictEqual(result.patterns.length, 0);
    assert.strictEqual(result.stats.totalSequences, 0);
});

console.log('');
console.log('7. Anomaly Detector Tests');
console.log('-'.repeat(40));

const AnomalyDetector = require('../src/anomalyDetector');

test('should detect pupil diameter anomaly', (done) => {
    const detector = new AnomalyDetector({
        sigmaThreshold: 3,
        windowSize: 50,
        cooldownMs: 0,
        minSamplesForDetection: 10
    });
    
    let anomalyReceived = null;
    detector.on('anomaly', (anomaly) => {
        anomalyReceived = anomaly;
    });
    
    detector.start();
    
    for (let i = 0; i < 30; i++) {
        detector.processDataPoint({ pupilDiameter: 3.0 + Math.random() * 0.2, timestamp: Date.now() + i * 4 });
    }
    
    const anomalyResult = detector.processDataPoint({ pupilDiameter: 8.0, timestamp: Date.now() + 120 });
    
    assert(anomalyResult !== null, 'Should detect anomaly');
    assert(anomalyResult.type === 'anomaly', 'Should be anomaly type');
    assert(anomalyResult.zScore > 3, `Z-score ${anomalyResult.zScore} should be > 3`);
    assert(anomalyResult.alertType === 'possible_fatigue', 'Should flag as possible_fatigue');
    
    detector.stop();
    done();
});

test('should not trigger with normal data', () => {
    const detector = new AnomalyDetector({
        sigmaThreshold: 3,
        windowSize: 100,
        cooldownMs: 0,
        minSamplesForDetection: 10
    });
    
    detector.start();
    
    for (let i = 0; i < 50; i++) {
        const result = detector.processDataPoint({ pupilDiameter: 3.0 + Math.random() * 0.3, timestamp: Date.now() + i * 4 });
        assert(result === null || result.type !== 'anomaly', 'Should not detect anomaly in normal data');
    }
    
    detector.stop();
});

test('should respect cooldown period', () => {
    const detector = new AnomalyDetector({
        sigmaThreshold: 3,
        windowSize: 50,
        cooldownMs: 10000,
        minSamplesForDetection: 10
    });
    
    detector.start();
    
    for (let i = 0; i < 30; i++) {
        detector.processDataPoint({ pupilDiameter: 3.0 + Math.random() * 0.2, timestamp: Date.now() + i * 4 });
    }
    
    const first = detector.processDataPoint({ pupilDiameter: 8.0, timestamp: Date.now() + 120 });
    const second = detector.processDataPoint({ pupilDiameter: 8.0, timestamp: Date.now() + 124 });
    
    assert(first && first.type === 'anomaly', 'First should be anomaly');
    assert(second && second.type === 'suppressed', 'Second should be suppressed');
    
    detector.stop();
});

test('should detect constriction as well', (done) => {
    const detector = new AnomalyDetector({
        sigmaThreshold: 3,
        windowSize: 50,
        cooldownMs: 0,
        minSamplesForDetection: 10
    });
    
    detector.start();
    
    for (let i = 0; i < 30; i++) {
        detector.processDataPoint({ pupilDiameter: 4.0 + Math.random() * 0.2, timestamp: Date.now() + i * 4 });
    }
    
    const result = detector.processDataPoint({ pupilDiameter: 0.5, timestamp: Date.now() + 120 });
    
    assert(result !== null, 'Should detect constriction');
    assert(result.direction === 'constriction', 'Should be constriction direction');
    assert(result.alertType === 'pupil_constriction', 'Should be pupil_constriction');
    
    detector.stop();
    done();
});

test('should return correct stats', () => {
    const detector = new AnomalyDetector({ sigmaThreshold: 3 });
    detector.start();
    
    const stats = detector.getStats();
    assert.strictEqual(stats.isRunning, true);
    assert.strictEqual(stats.sigmaThreshold, 3);
    
    detector.stop();
    const stoppedStats = detector.getStats();
    assert.strictEqual(stoppedStats.isRunning, false);
});

test('should batch detect anomalies in historical data', () => {
    const detector = new AnomalyDetector({
        sigmaThreshold: 3,
        windowSize: 50,
        cooldownMs: 0,
        minSamplesForDetection: 10
    });
    
    const dataPoints = [];
    const now = Date.now();
    
    for (let i = 0; i < 100; i++) {
        dataPoints.push({ pupilDiameter: 3.0 + Math.random() * 0.2, timestamp: now + i * 4 });
    }
    
    dataPoints.push({ pupilDiameter: 10.0, timestamp: now + 400 });
    dataPoints.push({ pupilDiameter: 0.1, timestamp: now + 404 });
    
    for (let i = 0; i < 50; i++) {
        dataPoints.push({ pupilDiameter: 3.0 + Math.random() * 0.2, timestamp: now + 408 + i * 4 });
    }
    
    const anomalies = detector.batchDetect(dataPoints);
    
    assert(anomalies.length >= 1, `Should find at least 1 anomaly, found ${anomalies.length}`);
});

runTests();
