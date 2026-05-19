import type { BuiltinTool } from '../registry';
import { ToolJsonValue } from '../dto/tool.dto';

type CalculatorOperation = 'add' | 'subtract' | 'multiply' | 'divide';

const operations = new Set<CalculatorOperation>([
  'add',
  'subtract',
  'multiply',
  'divide',
]);

export const calculatorTool: BuiltinTool = {
  id: 'calculator',
  name: '计算器',
  description: '执行基础数学计算，适合处理确定性的数字运算。',
  enabled: true,
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: [...operations],
        description: '要执行的计算操作。',
      },
      operands: {
        type: 'array',
        items: {
          type: 'number',
        },
        minItems: 2,
        description: '参与计算的数字列表。',
      },
    },
    required: ['operation', 'operands'],
    additionalProperties: false,
  },
  async execute(input) {
    const operation = normalizeOperation(input.operation);
    const operands = normalizeOperands(input.operands);
    const result = calculate(operation, operands);

    return {
      operation,
      operands,
      result,
    };
  },
};

function normalizeOperation(value: ToolJsonValue): CalculatorOperation {
  if (typeof value !== 'string' || !operations.has(value as CalculatorOperation)) {
    throw new Error('operation must be one of add, subtract, multiply, divide');
  }

  return value as CalculatorOperation;
}

function normalizeOperands(value: ToolJsonValue): number[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error('operands must contain at least 2 numbers');
  }

  return value.map((item) => {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      throw new Error('operands must contain finite numbers');
    }

    return item;
  });
}

function calculate(operation: CalculatorOperation, operands: number[]): number {
  if (operation === 'add') {
    return operands.reduce((sum, item) => sum + item, 0);
  }

  if (operation === 'subtract') {
    return operands.slice(1).reduce((result, item) => result - item, operands[0]);
  }

  if (operation === 'multiply') {
    return operands.reduce((result, item) => result * item, 1);
  }

  if (operands.slice(1).some((item) => item === 0)) {
    throw new Error('division by zero is not allowed');
  }

  return operands.slice(1).reduce((result, item) => result / item, operands[0]);
}
