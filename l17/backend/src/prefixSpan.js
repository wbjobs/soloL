class PrefixSpan {
  constructor(options = {}) {
    this.minSupport = options.minSupport || 0.05;
    this.minSupportCount = options.minSupportCount || 0;
    this.maxPatternLength = options.maxPatternLength || 10;
    this.minPatternLength = options.minPatternLength || 2;
  }

  mine(sequences) {
    if (!sequences || sequences.length === 0) {
      return { patterns: [], stats: this.createStats(0, 0, 0) };
    }

    const totalSequences = sequences.length;
    const minCount = this.minSupportCount > 0
      ? this.minSupportCount
      : Math.ceil(this.minSupport * totalSequences);

    const items = this.findAllItems(sequences);
    const frequentItems = items.filter(item => {
      const count = this.countItemSupport(item, sequences);
      return count >= minCount;
    });

    const results = [];

    for (const item of frequentItems) {
      const supportCount = this.countItemSupport(item, sequences);
      results.push({
        pattern: [item],
        support: supportCount,
        supportRate: supportCount / totalSequences,
        length: 1
      });
    }

    const prefixResults = this.prefixSpanRecursive(
      [], sequences, minCount, totalSequences, 1
    );

    results.push(...prefixResults);

    const patterns = results
      .filter(p => p.length >= this.minPatternLength)
      .sort((a, b) => b.support - a.support || a.length - b.length);

    return {
      patterns,
      stats: this.createStats(
        totalSequences,
        minCount,
        patterns.length,
        frequentItems.length
      )
    };
  }

  prefixSpanRecursive(prefix, projectedDB, minCount, totalSequences, depth) {
    if (depth >= this.maxPatternLength) {
      return [];
    }

    const results = [];
    const localItems = this.findAllItems(projectedDB);
    const frequentItems = localItems.filter(item => {
      const count = this.countItemSupport(item, projectedDB);
      return count >= minCount;
    });

    for (const item of frequentItems) {
      const newPrefix = [...prefix, item];
      const supportCount = this.countItemSupport(item, projectedDB);

      results.push({
        pattern: newPrefix,
        support: supportCount,
        supportRate: supportCount / totalSequences,
        length: newPrefix.length
      });

      const newProjectedDB = this.projectDatabase(item, projectedDB);

      if (newProjectedDB.length >= minCount) {
        const subResults = this.prefixSpanRecursive(
          newPrefix, newProjectedDB, minCount, totalSequences, depth + 1
        );
        results.push(...subResults);
      }
    }

    return results;
  }

  projectDatabase(item, sequences) {
    const projected = [];

    for (const seq of sequences) {
      const projectedSeq = this.projectSequence(item, seq);
      if (projectedSeq && projectedSeq.length > 0) {
        projected.push(projectedSeq);
      }
    }

    return projected;
  }

  projectSequence(item, sequence) {
    const itemIndex = sequence.indexOf(item);
    if (itemIndex === -1) {
      return null;
    }
    return sequence.slice(itemIndex + 1);
  }

  findAllItems(sequences) {
    const itemSet = new Set();
    for (const seq of sequences) {
      for (const item of seq) {
        itemSet.add(item);
      }
    }
    return Array.from(itemSet).sort();
  }

  countItemSupport(item, sequences) {
    let count = 0;
    for (const seq of sequences) {
      if (seq.includes(item)) {
        count++;
      }
    }
    return count;
  }

  generateSankeyData(patterns, aoiMap) {
    const nodes = new Map();
    const links = [];
    const linkMap = new Map();

    for (const pattern of patterns) {
      const { pattern: seq, support } = pattern;

      for (let i = 0; i < seq.length; i++) {
        const aoiId = seq[i];
        const stepKey = `${aoiId}_step${i}`;

        if (!nodes.has(stepKey)) {
          nodes.set(stepKey, {
            id: stepKey,
            aoiId,
            name: aoiMap[aoiId] || aoiId,
            step: i,
            totalFlow: 0
          });
        }
        nodes.get(stepKey).totalFlow += support;
      }

      for (let i = 0; i < seq.length - 1; i++) {
        const sourceKey = `${seq[i]}_step${i}`;
        const targetKey = `${seq[i + 1]}_step${i + 1}`;
        const linkKey = `${sourceKey}->${targetKey}`;

        if (linkMap.has(linkKey)) {
          linkMap.get(linkKey).value += support;
        } else {
          linkMap.set(linkKey, {
            source: sourceKey,
            target: targetKey,
            value: support,
            sourceAOI: seq[i],
            targetAOI: seq[i + 1],
            sourceName: aoiMap[seq[i]] || seq[i],
            targetName: aoiMap[seq[i + 1]] || seq[i + 1]
          });
        }
      }
    }

    return {
      nodes: Array.from(nodes.values()),
      links: Array.from(linkMap.values())
    };
  }

  buildSequencesFromScanPath(scanPath, gapThresholdMs = 5000) {
    if (!scanPath || scanPath.length === 0) {
      return [];
    }

    const sequences = [];
    let currentSequence = [scanPath[0].aoiId];

    for (let i = 1; i < scanPath.length; i++) {
      const timeDiff = scanPath[i].timestamp - scanPath[i - 1].timestamp;

      if (timeDiff > gapThresholdMs) {
        if (currentSequence.length >= 2) {
          sequences.push(this.compressSequence(currentSequence));
        }
        currentSequence = [scanPath[i].aoiId];
      } else {
        currentSequence.push(scanPath[i].aoiId);
      }
    }

    if (currentSequence.length >= 2) {
      sequences.push(this.compressSequence(currentSequence));
    }

    return sequences;
  }

  compressSequence(sequence) {
    if (sequence.length === 0) return [];
    const compressed = [sequence[0]];
    for (let i = 1; i < sequence.length; i++) {
      if (sequence[i] !== sequence[i - 1]) {
        compressed.push(sequence[i]);
      }
    }
    return compressed;
  }

  createStats(totalSequences, minCount, patternCount, frequentItemCount) {
    return {
      totalSequences,
      minSupportCount: minCount,
      minSupportRate: this.minSupport,
      patternCount,
      frequentItemCount: frequentItemCount || 0,
      maxPatternLength: this.maxPatternLength
    };
  }
}

module.exports = PrefixSpan;
