import { BoundFile, ResolvedEnvironment, PipelineStep, PipelineStepResult, PipelineExecutionResult } from './types';
import { evaluateExpression, stringify, StdoutCallback, StdoutEntry } from './evaluator';

export interface PipelineExecuteOptions {
  steps: PipelineStep[];
  boundFiles: BoundFile[];
  dataMap: Record<string, unknown>;
  environmentVariables?: Record<string, string> | ResolvedEnvironment;
  onStdout?: StdoutCallback;
  onStepComplete?: (stepResult: PipelineStepResult, stepIndex: number, totalSteps: number) => void;
}

/**
 * Returns item count for arrays or key count for plain objects.
 */
export function getItemCount(val: unknown): number | undefined {
  if (Array.isArray(val)) {
    return val.length;
  }
  if (val !== null && typeof val === 'object' && !(val instanceof Date) && !(val instanceof RegExp)) {
    return Object.keys(val).length;
  }
  return undefined;
}

/**
 * Validates whether an alias is a valid JavaScript identifier.
 */
export function isValidStepAlias(alias: string): boolean {
  if (!alias || typeof alias !== 'string') return false;
  const trimmed = alias.trim();
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmed);
}

/**
 * Executes an ordered multi-step pipeline sequentially, piping intermediate outputs
 * from step to step, scoping variables, and capturing step execution metrics.
 */
export async function executePipeline(options: PipelineExecuteOptions): Promise<PipelineExecutionResult> {
  const { steps, boundFiles, dataMap, environmentVariables, onStdout, onStepComplete } = options;
  const startTime = performance.now();

  const stepResults: PipelineStepResult[] = [];
  const stepOutputs: Record<string, unknown> = {};

  // Initial input data
  let currentInput: unknown = dataMap['data'] !== undefined ? dataMap['data'] : dataMap;
  let failedStepId: string | undefined;
  let pipelineError: string | undefined;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepNum = i + 1;
    const defaultAlias = `step${stepNum}`;
    const alias = isValidStepAlias(step.alias) ? step.alias : defaultAlias;
    const validName = isValidStepAlias(step.name) && step.name !== alias && step.name !== defaultAlias ? step.name : undefined;

    if (!step.enabled) {
      // Step is disabled: bypass and pass currentInput directly through
      const stepRes: PipelineStepResult = {
        id: step.id,
        name: step.name || `Step ${stepNum}`,
        alias,
        enabled: false,
        durationMs: 0,
        byteSize: 0,
        itemCount: getItemCount(currentInput),
        output: currentInput,
        text: '(Bypassed: passed input through)'
      };
      stepResults.push(stepRes);
      stepOutputs[alias] = currentInput;
      stepOutputs[defaultAlias] = currentInput;
      if (validName) {
        stepOutputs[validName] = currentInput;
      }
      onStepComplete?.(stepRes, stepNum, steps.length);
      continue;
    }

    // Step is active: assemble scoped data map
    const stepDataMap: Record<string, unknown> = {
      ...dataMap,
      data: dataMap['data'] !== undefined ? dataMap['data'] : currentInput,
      raw: dataMap['raw'] !== undefined ? dataMap['raw'] : dataMap['data'],
      input: currentInput,
      prev: currentInput,
      ...stepOutputs,
      [defaultAlias]: currentInput
    };
    if (validName) {
      stepDataMap[validName] = currentInput;
    }

    const stepStart = performance.now();

    // Wrap stdout to tag logs with current step context
    const stepStdout: StdoutCallback | undefined = onStdout
      ? (entry: StdoutEntry) => {
          onStdout({
            ...entry,
            text: `[Step ${stepNum}: ${step.name || alias}] ${entry.text}`,
            message: `[Step ${stepNum}: ${step.name || alias}] ${entry.message}`
          });
        }
      : undefined;

    try {
      let output = evaluateExpression(
        boundFiles,
        stepDataMap,
        step.expr,
        environmentVariables,
        stepStdout
      );

      if (output && (output instanceof Promise || typeof (output as any).then === 'function')) {
        output = await output;
      }

      const stepDuration = Math.round((performance.now() - stepStart) * 10) / 10;
      const stepText = stringify(output);
      const byteSize = Buffer.byteLength(stepText, 'utf-8');
      const itemCount = getItemCount(output);

      const stepRes: PipelineStepResult = {
        id: step.id,
        name: step.name || `Step ${stepNum}`,
        alias,
        enabled: true,
        durationMs: stepDuration,
        byteSize,
        itemCount,
        output,
        text: stepText
      };

      stepResults.push(stepRes);
      currentInput = output;
      stepOutputs[alias] = output;
      stepOutputs[defaultAlias] = output;
      if (validName) {
        stepOutputs[validName] = output;
      }
      onStepComplete?.(stepRes, stepNum, steps.length);
    } catch (err: any) {
      const stepDuration = Math.round((performance.now() - stepStart) * 10) / 10;
      const errMsg = err?.message || String(err);
      failedStepId = step.id;
      pipelineError = `Step ${stepNum} ("${step.name || alias}") failed: ${errMsg}`;

      const stepRes: PipelineStepResult = {
        id: step.id,
        name: step.name || `Step ${stepNum}`,
        alias,
        enabled: true,
        durationMs: stepDuration,
        byteSize: 0,
        output: null,
        error: errMsg
      };
      stepResults.push(stepRes);
      onStepComplete?.(stepRes, stepNum, steps.length);

      // Abort execution of remaining steps and append them as disabled/unexecuted
      for (let j = i + 1; j < steps.length; j++) {
        const remainingStep = steps[j];
        stepResults.push({
          id: remainingStep.id,
          name: remainingStep.name || `Step ${j + 1}`,
          alias: remainingStep.alias || `step${j + 1}`,
          enabled: false,
          durationMs: 0,
          byteSize: 0,
          output: null
        });
      }
      break;
    }
  }

  const totalDurationMs = Math.round((performance.now() - startTime) * 10) / 10;

  return {
    success: !pipelineError,
    steps: stepResults,
    finalResult: currentInput,
    durationMs: totalDurationMs,
    failedStepId,
    error: pipelineError
  };
}

/**
 * Compiles a list of pipeline steps into a single, self-contained JavaScript query expression.
 */
export function exportPipelineToSingleQuery(steps: PipelineStep[]): string {
  const activeSteps = steps.filter(s => s.enabled && s.expr && s.expr.trim().length > 0);
  if (activeSteps.length === 0) {
    return 'data;';
  }

  const lines: string[] = [
    '// Consolidated Multi-Step Data Pipeline Query',
    'return (() => {',
    '  let prev = data;'
  ];

  const definedAliases: string[] = ['data', 'input', 'prev'];

  for (let i = 0; i < activeSteps.length; i++) {
    const s = activeSteps[i];
    const stepNum = i + 1;
    const defaultAlias = `step${stepNum}`;
    const alias = isValidStepAlias(s.alias) ? s.alias : defaultAlias;
    const validName = isValidStepAlias(s.name) && s.name !== alias && s.name !== defaultAlias ? s.name : undefined;
    const cleanExpr = s.expr.trim().replace(/;+$/, '');

    lines.push('');
    lines.push(`  // Step ${stepNum}: ${s.name || alias}`);

    const params = Array.from(new Set(definedAliases)).join(', ');
    const args = Array.from(new Set(definedAliases))
      .map(p => (p === 'input' || p === 'prev' ? 'prev' : p))
      .join(', ');

    // Determine whether expression is multi-line or return block
    const hasReturn = /\breturn\b/.test(cleanExpr);
    const isBlockStatement =
      hasReturn ||
      cleanExpr.includes('\n') ||
      cleanExpr.includes(';') ||
      cleanExpr.startsWith('const ') ||
      cleanExpr.startsWith('let ') ||
      cleanExpr.startsWith('var ') ||
      cleanExpr.startsWith('if ') ||
      cleanExpr.startsWith('try ') ||
      cleanExpr.startsWith('switch ');

    if (isBlockStatement) {
      const body = hasReturn ? cleanExpr : `return (${cleanExpr});`;
      lines.push(`  const ${alias} = ((${params}) => {`);
      lines.push(`    ${body.split('\n').join('\n    ')}`);
      lines.push(`  })(${args});`);
    } else {
      lines.push(`  const ${alias} = ((${params}) => (${cleanExpr}))(${args});`);
    }

    lines.push(`  prev = ${alias};`);
    definedAliases.push(alias);
    if (alias !== defaultAlias) {
      definedAliases.push(defaultAlias);
      lines.push(`  const ${defaultAlias} = ${alias};`);
    }
    if (validName) {
      definedAliases.push(validName);
      lines.push(`  const ${validName} = ${alias};`);
    }
  }

  lines.push('');
  lines.push('  return prev;');
  lines.push('})();');

  return lines.join('\n');
}
