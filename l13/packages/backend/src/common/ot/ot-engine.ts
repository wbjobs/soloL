export enum OpType {
  INSERT = 'insert',
  DELETE = 'delete',
  RETAIN = 'retain',
}

export interface InsertOp {
  type: OpType.INSERT;
  text: string;
}

export interface DeleteOp {
  type: OpType.DELETE;
  count: number;
}

export interface RetainOp {
  type: OpType.RETAIN;
  count: number;
}

export type Op = InsertOp | DeleteOp | RetainOp;

export class TextOperation {
  ops: Op[] = [];
  baseLength = 0;
  targetLength = 0;

  static insert(text: string): InsertOp {
    return { type: OpType.INSERT, text };
  }

  static delete(count: number): DeleteOp {
    return { type: OpType.DELETE, count };
  }

  static retain(count: number): RetainOp {
    return { type: OpType.RETAIN, count };
  }

  retain(count: number): this {
    if (count <= 0) return this;
    this.baseLength += count;
    this.targetLength += count;
    const last = this.ops[this.ops.length - 1];
    if (last && last.type === OpType.RETAIN) {
      (last as RetainOp).count += count;
    } else {
      this.ops.push(TextOperation.retain(count));
    }
    return this;
  }

  insert(text: string): this {
    if (text.length === 0) return this;
    this.targetLength += text.length;
    const last = this.ops[this.ops.length - 1];
    if (last && last.type === OpType.INSERT) {
      (last as InsertOp).text += text;
    } else if (last && last.type === OpType.DELETE) {
      const secondLast = this.ops[this.ops.length - 2];
      if (secondLast && secondLast.type === OpType.INSERT) {
        (secondLast as InsertOp).text += text;
      } else {
        this.ops.splice(this.ops.length - 1, 0, TextOperation.insert(text));
      }
    } else {
      this.ops.push(TextOperation.insert(text));
    }
    return this;
  }

  delete(count: number): this {
    if (count <= 0) return this;
    this.baseLength += count;
    const last = this.ops[this.ops.length - 1];
    if (last && last.type === OpType.DELETE) {
      (last as DeleteOp).count += count;
    } else {
      this.ops.push(TextOperation.delete(count));
    }
    return this;
  }

  isNoop(): boolean {
    return this.ops.length === 0 || (this.ops.length === 1 && this.ops[0].type === OpType.RETAIN);
  }

  equals(other: TextOperation): boolean {
    if (this.baseLength !== other.baseLength) return false;
    if (this.targetLength !== other.targetLength) return false;
    if (this.ops.length !== other.ops.length) return false;
    for (let i = 0; i < this.ops.length; i++) {
      const a = this.ops[i];
      const b = other.ops[i];
      if (a.type !== b.type) return false;
      if (a.type === OpType.INSERT && (a as InsertOp).text !== (b as InsertOp).text) return false;
      if (a.type === OpType.DELETE && (a as DeleteOp).count !== (b as DeleteOp).count) return false;
      if (a.type === OpType.RETAIN && (a as RetainOp).count !== (b as RetainOp).count) return false;
    }
    return true;
  }

  apply(doc: string): string {
    if (doc.length !== this.baseLength) {
      throw new Error(
        `Document length mismatch: expected ${this.baseLength}, got ${doc.length}`,
      );
    }

    let result = '';
    let offset = 0;

    for (const op of this.ops) {
      switch (op.type) {
        case OpType.RETAIN:
          result += doc.substring(offset, offset + (op as RetainOp).count);
          offset += (op as RetainOp).count;
          break;
        case OpType.INSERT:
          result += (op as InsertOp).text;
          break;
        case OpType.DELETE:
          offset += (op as DeleteOp).count;
          break;
      }
    }

    if (offset !== doc.length) {
      throw new Error(
        `Operation did not consume entire document: consumed ${offset}, expected ${doc.length}`,
      );
    }

    return result;
  }

  static transform(operation1: TextOperation, operation2: TextOperation): [TextOperation, TextOperation] {
    if (operation1.baseLength !== operation2.baseLength) {
      throw new Error(
        `Base length mismatch for transform: ${operation1.baseLength} vs ${operation2.baseLength}`,
      );
    }

    const op1prime = new TextOperation();
    const op2prime = new TextOperation();
    const ops1 = operation1.ops;
    const ops2 = operation2.ops;
    let i1 = 0;
    let i2 = 0;
    let op1 = ops1[i1++];
    let op2 = ops2[i2++];

    while (true) {
      if (op1 == null && op2 == null) break;

      if (op1 && op1.type === OpType.INSERT) {
        op1prime.insert((op1 as InsertOp).text);
        op2prime.retain((op1 as InsertOp).text.length);
        op1 = ops1[i1++];
        continue;
      }

      if (op2 && op2.type === OpType.INSERT) {
        op1prime.retain((op2 as InsertOp).text.length);
        op2prime.insert((op2 as InsertOp).text);
        op2 = ops2[i2++];
        continue;
      }

      if (op1 == null) {
        throw new Error('Operation1 reached end prematurely');
      }
      if (op2 == null) {
        throw new Error('Operation2 reached end prematurely');
      }

      if (op1.type === OpType.RETAIN && op2.type === OpType.RETAIN) {
        const retain1 = op1 as RetainOp;
        const retain2 = op2 as RetainOp;
        const minCount = Math.min(retain1.count, retain2.count);
        op1prime.retain(minCount);
        op2prime.retain(minCount);
        if (retain1.count > retain2.count) {
          retain1.count -= retain2.count;
          op2 = ops2[i2++];
        } else if (retain1.count < retain2.count) {
          retain2.count -= retain1.count;
          op1 = ops1[i1++];
        } else {
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        }
      } else if (op1.type === OpType.DELETE && op2.type === OpType.DELETE) {
        const del1 = op1 as DeleteOp;
        const del2 = op2 as DeleteOp;
        if (del1.count > del2.count) {
          del1.count -= del2.count;
          op2 = ops2[i2++];
        } else if (del1.count < del2.count) {
          del2.count -= del1.count;
          op1 = ops1[i1++];
        } else {
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        }
      } else if (op1.type === OpType.DELETE && op2.type === OpType.RETAIN) {
        const del1 = op1 as DeleteOp;
        const ret2 = op2 as RetainOp;
        const minCount = Math.min(del1.count, ret2.count);
        op1prime.delete(minCount);
        if (del1.count > ret2.count) {
          del1.count -= ret2.count;
          op2 = ops2[i2++];
        } else if (del1.count < ret2.count) {
          ret2.count -= del1.count;
          op1 = ops1[i1++];
        } else {
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        }
      } else if (op1.type === OpType.RETAIN && op2.type === OpType.DELETE) {
        const ret1 = op1 as RetainOp;
        const del2 = op2 as DeleteOp;
        const minCount = Math.min(ret1.count, del2.count);
        op2prime.delete(minCount);
        if (ret1.count > del2.count) {
          ret1.count -= del2.count;
          op2 = ops2[i2++];
        } else if (ret1.count < del2.count) {
          del2.count -= ret1.count;
          op1 = ops1[i1++];
        } else {
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        }
      } else {
        throw new Error(`Unexpected op pair: ${op1.type}, ${op2.type}`);
      }
    }

    return [op1prime, op2prime];
  }

  static compose(operation1: TextOperation, operation2: TextOperation): TextOperation {
    if (operation1.targetLength !== operation2.baseLength) {
      throw new Error(
        `Compose length mismatch: operation1 target ${operation1.targetLength} vs operation2 base ${operation2.baseLength}`,
      );
    }

    const result = new TextOperation();
    const ops1 = operation1.ops;
    const ops2 = operation2.ops;
    let i1 = 0;
    let i2 = 0;
    let op1 = ops1[i1++];
    let op2 = ops2[i2++];

    while (true) {
      if (op1 == null && op2 == null) break;

      if (op1 && op1.type === OpType.DELETE) {
        result.delete((op1 as DeleteOp).count);
        op1 = ops1[i1++];
        continue;
      }

      if (op2 && op2.type === OpType.INSERT) {
        result.insert((op2 as InsertOp).text);
        op2 = ops2[i2++];
        continue;
      }

      if (op1 == null) {
        throw new Error('Operation1 reached end prematurely in compose');
      }
      if (op2 == null) {
        throw new Error('Operation2 reached end prematurely in compose');
      }

      if (op1.type === OpType.RETAIN && op2.type === OpType.RETAIN) {
        const retain1 = op1 as RetainOp;
        const retain2 = op2 as RetainOp;
        const minCount = Math.min(retain1.count, retain2.count);
        result.retain(minCount);
        if (retain1.count > retain2.count) {
          retain1.count -= retain2.count;
          op2 = ops2[i2++];
        } else if (retain1.count < retain2.count) {
          retain2.count -= retain1.count;
          op1 = ops1[i1++];
        } else {
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        }
      } else if (op1.type === OpType.INSERT && op2.type === OpType.DELETE) {
        const ins1 = op1 as InsertOp;
        const del2 = op2 as DeleteOp;
        if (ins1.text.length > del2.count) {
          ins1.text = ins1.text.substring(del2.count);
          op2 = ops2[i2++];
        } else if (ins1.text.length < del2.count) {
          del2.count -= ins1.text.length;
          op1 = ops1[i1++];
        } else {
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        }
      } else if (op1.type === OpType.INSERT && op2.type === OpType.RETAIN) {
        const ins1 = op1 as InsertOp;
        const ret2 = op2 as RetainOp;
        const minCount = Math.min(ins1.text.length, ret2.count);
        result.insert(ins1.text.substring(0, minCount));
        if (ins1.text.length > ret2.count) {
          ins1.text = ins1.text.substring(ret2.count);
          op2 = ops2[i2++];
        } else if (ins1.text.length < ret2.count) {
          ret2.count -= ins1.text.length;
          op1 = ops1[i1++];
        } else {
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        }
      } else if (op1.type === OpType.RETAIN && op2.type === OpType.DELETE) {
        const ret1 = op1 as RetainOp;
        const del2 = op2 as DeleteOp;
        const minCount = Math.min(ret1.count, del2.count);
        result.delete(minCount);
        if (ret1.count > del2.count) {
          ret1.count -= del2.count;
          op2 = ops2[i2++];
        } else if (ret1.count < del2.count) {
          del2.count -= ret1.count;
          op1 = ops1[i1++];
        } else {
          op1 = ops1[i1++];
          op2 = ops2[i2++];
        }
      } else {
        throw new Error(`Unexpected compose op pair: ${op1.type}, ${op2.type}`);
      }
    }

    return result;
  }

  toJSON(): object[] {
    return this.ops.map((op) => {
      switch (op.type) {
        case OpType.INSERT:
          return { type: OpType.INSERT, text: (op as InsertOp).text };
        case OpType.DELETE:
          return { type: OpType.DELETE, count: (op as DeleteOp).count };
        case OpType.RETAIN:
          return { type: OpType.RETAIN, count: (op as RetainOp).count };
      }
    });
  }

  static fromJSON(ops: object[]): TextOperation {
    const operation = new TextOperation();
    for (const rawOp of ops) {
      const op = rawOp as any;
      switch (op.type) {
        case OpType.INSERT:
          operation.insert(op.text);
          break;
        case OpType.DELETE:
          operation.delete(op.count);
          break;
        case OpType.RETAIN:
          operation.retain(op.count);
          break;
        default:
          throw new Error(`Unknown op type: ${op.type}`);
      }
    }
    return operation;
  }
}
