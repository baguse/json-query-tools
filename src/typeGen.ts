/**
 * Multi-Language Type & Contract Generator for JSON Tools.
 * Supports:
 * - TypeScript (interfaces & type aliases with optional fields and JSDoc)
 * - Zod (z.object schemas with inferred static types)
 * - JSON Schema (Draft-07 standard compliant schemas)
 * - Python Pydantic v2 (BaseModel with Field alias mapping & topological ordering)
 * - Python Dataclasses (@dataclass with typing annotations & non-default order safety)
 *
 * Zero external runtime dependencies.
 */

export type ContractTarget = 'typescript' | 'ts' | 'zod' | 'json-schema' | 'pydantic' | 'dataclass';

export interface TypeGenOptions {
  rootName?: string;
  exportKeyword?: boolean;
  useInterface?: boolean;
  useSnakeCase?: boolean;
  pydanticVersion?: 'v2';
}

export type PrimitiveTypeName = 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'any';

export interface IntermediateField {
  key: string;
  originalKey: string;
  type: IntermediateType;
  optional: boolean;
  nullable: boolean;
  description?: string;
}

export type IntermediateType =
  | { kind: 'primitive'; primitive: PrimitiveTypeName }
  | { kind: 'object'; modelName: string; fields: IntermediateField[] }
  | { kind: 'array'; itemType: IntermediateType }
  | { kind: 'union'; types: IntermediateType[] }
  | { kind: 'any' };

export interface ExtractedModel {
  name: string;
  fields: IntermediateField[];
  dependencies: string[];
}

const PYTHON_RESERVED_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
  'id', 'type', 'object', 'dict', 'list', 'str', 'int', 'float', 'bool', 'set'
]);

export function isPythonKeyword(name: string): boolean {
  return PYTHON_RESERVED_KEYWORDS.has(name);
}

export function toPascalCase(str: string): string {
  if (!str) return 'Model';
  const cleaned = str.replace(/[^a-zA-Z0-9_]/g, '_');
  const parts = cleaned.split(/[_\-\s]+/).filter(Boolean);
  if (parts.length === 0) return 'Model';
  let res = parts
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
  if (/^[0-9]/.test(res)) {
    res = 'Model' + res;
  }
  return res || 'Model';
}

export function toSnakeCase(str: string): string {
  if (!str) return 'field';
  let s = str
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .toLowerCase();
  s = s.replace(/__+/g, '_').replace(/^_+|_+$/g, '');
  if (!s || /^[0-9]/.test(s)) {
    s = '_' + (s || 'field');
  }
  return s;
}

export function singularizeName(name: string): string {
  if (name.endsWith('ies') && name.length > 3) {
    return name.slice(0, -3) + 'y';
  }
  if (name.endsWith('ses') && name.length > 3) {
    return name.slice(0, -2);
  }
  if ((name.endsWith('us') || name.endsWith('is')) && name.length > 2) {
    return name;
  }
  if (name.endsWith('s') && !name.endsWith('ss') && name.length > 3) {
    return name.slice(0, -1);
  }
  return name;
}

export function isValidJsIdentifier(name: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

/**
 * Builds an Intermediate Representation (IR) from arbitrary JSON data or SchemaInfo.
 */
export class TypeAnalyzer {
  private modelCounter = 0;
  private registeredModels = new Map<string, ExtractedModel>();

  constructor(private readonly rootName: string = 'Root') {}

  public analyze(data: unknown): { rootType: IntermediateType; models: ExtractedModel[] } {
    this.registeredModels.clear();
    this.modelCounter = 0;
    const rootType = this.inferNode(data, this.rootName);
    const models = this.topologicalSort(Array.from(this.registeredModels.values()));
    return { rootType, models };
  }

  private inferNode(value: unknown, suggestedName: string): IntermediateType {
    if (value === null) {
      return { kind: 'primitive', primitive: 'null' };
    }
    if (value === undefined) {
      return { kind: 'any' };
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return { kind: 'array', itemType: { kind: 'any' } };
      }
      // Sample items
      const sample = value.slice(0, 50);
      const isAllObjects = sample.every(item => item && typeof item === 'object' && !Array.isArray(item));

      if (isAllObjects) {
        const itemModelName = toPascalCase(singularizeName(suggestedName)) + 'Item';
        const mergedObj = this.mergeObjectSample(sample as Record<string, unknown>[], itemModelName);
        return { kind: 'array', itemType: mergedObj };
      }

      // Check primitive union or single primitive type
      const elementTypes: IntermediateType[] = [];
      for (const item of sample) {
        const t = this.inferNode(item, singularizeName(suggestedName));
        if (!elementTypes.some(existing => this.areTypesEqual(existing, t))) {
          elementTypes.push(t);
        }
      }

      if (elementTypes.length === 1) {
        return { kind: 'array', itemType: elementTypes[0] };
      }
      return { kind: 'array', itemType: { kind: 'union', types: elementTypes } };
    }

    if (typeof value === 'object') {
      return this.extractObjectModel(value as Record<string, unknown>, suggestedName);
    }

    if (typeof value === 'boolean') {
      return { kind: 'primitive', primitive: 'boolean' };
    }

    if (typeof value === 'number') {
      return {
        kind: 'primitive',
        primitive: Number.isInteger(value) ? 'integer' : 'number'
      };
    }

    if (typeof value === 'string') {
      return { kind: 'primitive', primitive: 'string' };
    }

    return { kind: 'any' };
  }

  private areModelsEquivalent(modelA: ExtractedModel, fieldsB: IntermediateField[]): boolean {
    if (modelA.fields.length !== fieldsB.length) return false;
    const mapA = new Map(modelA.fields.map(f => [f.key, f]));
    for (const fb of fieldsB) {
      const fa = mapA.get(fb.key);
      if (!fa) return false;
      if (fa.optional !== fb.optional || fa.nullable !== fb.nullable) return false;
      if (!this.areTypesEqual(fa.type, fb.type)) return false;
    }
    return true;
  }

  private findEquivalentModel(fields: IntermediateField[]): ExtractedModel | undefined {
    for (const model of this.registeredModels.values()) {
      if (this.areModelsEquivalent(model, fields)) {
        return model;
      }
    }
    return undefined;
  }

  private extractObjectModel(obj: Record<string, unknown>, modelName: string): IntermediateType {
    const fields: IntermediateField[] = [];
    const dependencies: string[] = [];

    const keys = Object.keys(obj);
    for (const key of keys) {
      const val = obj[key];
      const childSuggestedName = toPascalCase(key);
      const childType = this.inferNode(val, childSuggestedName);

      if (childType.kind === 'object') {
        dependencies.push(childType.modelName);
      } else if (childType.kind === 'array' && childType.itemType.kind === 'object') {
        dependencies.push(childType.itemType.modelName);
      }

      fields.push({
        key,
        originalKey: key,
        type: childType,
        optional: val === undefined,
        nullable: val === null
      });
    }

    // Check if an existing model has identical structure
    const candidate = toPascalCase(modelName);
    const sameNameModel = this.registeredModels.get(candidate);
    if (sameNameModel && this.areModelsEquivalent(sameNameModel, fields)) {
      return { kind: 'object', modelName: candidate, fields: sameNameModel.fields };
    }

    const equivalentModel = this.findEquivalentModel(fields);
    if (equivalentModel) {
      return { kind: 'object', modelName: equivalentModel.name, fields: equivalentModel.fields };
    }

    let finalName = candidate;
    while (this.registeredModels.has(finalName)) {
      this.modelCounter++;
      finalName = `${candidate}${this.modelCounter}`;
    }

    const model: ExtractedModel = {
      name: finalName,
      fields,
      dependencies
    };
    this.registeredModels.set(finalName, model);

    return { kind: 'object', modelName: finalName, fields };
  }

  private mergeObjectSample(sample: Record<string, unknown>[], baseName: string): IntermediateType {
    const propertyCounts: Record<string, number> = {};
    const propertyValues: Record<string, unknown[]> = {};
    const totalCount = sample.length;

    for (const item of sample) {
      for (const [k, v] of Object.entries(item)) {
        propertyCounts[k] = (propertyCounts[k] || 0) + 1;
        if (!propertyValues[k]) propertyValues[k] = [];
        propertyValues[k].push(v);
      }
    }

    const fields: IntermediateField[] = [];
    const dependencies: string[] = [];

    for (const key of Object.keys(propertyCounts)) {
      const vals = propertyValues[key];
      const isOptional = propertyCounts[key] < totalCount || vals.includes(undefined);
      const isNullable = vals.includes(null);
      const nonNullVals = vals.filter(v => v !== null && v !== undefined);

      let fieldType: IntermediateType;
      const childSuggestedName = toPascalCase(key);

      if (nonNullVals.length === 0) {
        fieldType = { kind: 'primitive', primitive: 'null' };
      } else {
        const isAllObjects = nonNullVals.every(v => v && typeof v === 'object' && !Array.isArray(v));
        const isAllArrays = nonNullVals.every(v => Array.isArray(v));

        if (isAllObjects) {
          fieldType = this.mergeObjectSample(nonNullVals as Record<string, unknown>[], childSuggestedName);
        } else if (isAllArrays) {
          const flatItems = (nonNullVals as unknown[][]).flat();
          fieldType = {
            kind: 'array',
            itemType: this.inferNode(flatItems, singularizeName(childSuggestedName))
          };
        } else {
          // Partition mixed values
          const objVals = nonNullVals.filter(v => v && typeof v === 'object' && !Array.isArray(v)) as Record<string, unknown>[];
          const arrVals = nonNullVals.filter(v => Array.isArray(v)) as unknown[][];
          const primVals = nonNullVals.filter(v => typeof v !== 'object' || v === null);

          const types: IntermediateType[] = [];

          if (objVals.length > 0) {
            types.push(this.mergeObjectSample(objVals, childSuggestedName));
          }
          if (arrVals.length > 0) {
            types.push({
              kind: 'array',
              itemType: this.inferNode(arrVals.flat(), singularizeName(childSuggestedName))
            });
          }
          for (const v of primVals) {
            const t = this.inferNode(v, childSuggestedName);
            if (!types.some(existing => this.areTypesEqual(existing, t))) {
              types.push(t);
            }
          }

          if (types.length === 1) {
            fieldType = types[0];
          } else {
            const hasInt = types.some(t => t.kind === 'primitive' && t.primitive === 'integer');
            const hasNum = types.some(t => t.kind === 'primitive' && t.primitive === 'number');
            if (hasInt && hasNum && types.length === 2) {
              fieldType = { kind: 'primitive', primitive: 'number' };
            } else {
              fieldType = { kind: 'union', types };
            }
          }
        }
      }

      if (fieldType.kind === 'object') {
        dependencies.push(fieldType.modelName);
      } else if (fieldType.kind === 'array' && fieldType.itemType.kind === 'object') {
        dependencies.push(fieldType.itemType.modelName);
      }

      fields.push({
        key,
        originalKey: key,
        type: fieldType,
        optional: isOptional,
        nullable: isNullable
      });
    }

    const candidate = toPascalCase(baseName);
    const sameNameModel = this.registeredModels.get(candidate);
    if (sameNameModel && this.areModelsEquivalent(sameNameModel, fields)) {
      return { kind: 'object', modelName: candidate, fields: sameNameModel.fields };
    }

    const equivalentModel = this.findEquivalentModel(fields);
    if (equivalentModel) {
      return { kind: 'object', modelName: equivalentModel.name, fields: equivalentModel.fields };
    }

    let finalName = candidate;
    while (this.registeredModels.has(finalName)) {
      this.modelCounter++;
      finalName = `${candidate}${this.modelCounter}`;
    }

    const model: ExtractedModel = {
      name: finalName,
      fields,
      dependencies
    };
    this.registeredModels.set(finalName, model);

    return { kind: 'object', modelName: finalName, fields };
  }

  private areTypesEqual(a: IntermediateType, b: IntermediateType): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'primitive' && b.kind === 'primitive') return a.primitive === b.primitive;
    if (a.kind === 'object' && b.kind === 'object') return a.modelName === b.modelName;
    if (a.kind === 'array' && b.kind === 'array') return this.areTypesEqual(a.itemType, b.itemType);
    if (a.kind === 'union' && b.kind === 'union') {
      if (a.types.length !== b.types.length) return false;
      return a.types.every(at => b.types.some(bt => this.areTypesEqual(at, bt)));
    }
    return false;
  }

  private topologicalSort(models: ExtractedModel[]): ExtractedModel[] {
    const result: ExtractedModel[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const modelMap = new Map(models.map(m => [m.name, m]));

    const visit = (m: ExtractedModel) => {
      if (visited.has(m.name)) return;
      if (visiting.has(m.name)) {
        // Cycle detected, break cycle
        return;
      }
      visiting.add(m.name);
      for (const dep of m.dependencies) {
        const depModel = modelMap.get(dep);
        if (depModel) {
          visit(depModel);
        }
      }
      visiting.delete(m.name);
      visited.add(m.name);
      result.push(m);
    };

    for (const m of models) {
      visit(m);
    }

    return result;
  }
}

/**
 * 1. TypeScript Generator
 */
export function generateTypeScript(
  data: unknown,
  options: TypeGenOptions = {}
): string {
  const rootName = toPascalCase(options.rootName || 'Root');
  const exportKeyword = options.exportKeyword !== false ? 'export ' : '';
  const useInterface = options.useInterface !== false;

  const analyzer = new TypeAnalyzer(rootName);
  const { rootType, models } = analyzer.analyze(data);

  const lines: string[] = [];

  function formatType(t: IntermediateType): string {
    switch (t.kind) {
      case 'primitive':
        if (t.primitive === 'integer' || t.primitive === 'number') return 'number';
        if (t.primitive === 'boolean') return 'boolean';
        if (t.primitive === 'string') return 'string';
        if (t.primitive === 'null') return 'null';
        return 'any';
      case 'object':
        return t.modelName;
      case 'array':
        const inner = formatType(t.itemType);
        return inner.includes('|') ? `(${inner})[]` : `${inner}[]`;
      case 'union':
        return t.types.map(formatType).join(' | ') || 'any';
      case 'any':
      default:
        return 'any';
    }
  }

  // Generate sub-models
  for (const m of models) {
    if (m.name === rootName && rootType.kind === 'object') {
      continue; // Will generate at root
    }

    if (useInterface) {
      lines.push(`${exportKeyword}interface ${m.name} {`);
      for (const f of m.fields) {
        const safeKey = isValidJsIdentifier(f.key) ? f.key : JSON.stringify(f.key);
        const optMark = f.optional ? '?' : '';
        let typeStr = formatType(f.type);
        if (f.nullable && !typeStr.includes('null')) {
          typeStr += ' | null';
        }
        lines.push(`  ${safeKey}${optMark}: ${typeStr};`);
      }
      lines.push('}\n');
    } else {
      lines.push(`${exportKeyword}type ${m.name} = {`);
      for (const f of m.fields) {
        const safeKey = isValidJsIdentifier(f.key) ? f.key : JSON.stringify(f.key);
        const optMark = f.optional ? '?' : '';
        let typeStr = formatType(f.type);
        if (f.nullable && !typeStr.includes('null')) {
          typeStr += ' | null';
        }
        lines.push(`  ${safeKey}${optMark}: ${typeStr};`);
      }
      lines.push('};\n');
    }
  }

  // Generate Root
  if (rootType.kind === 'object') {
    const rootModel = models.find(m => m.name === rootName);
    const fields = rootModel ? rootModel.fields : (rootType.fields || []);
    if (useInterface) {
      lines.push(`${exportKeyword}interface ${rootName} {`);
      for (const f of fields) {
        const safeKey = isValidJsIdentifier(f.key) ? f.key : JSON.stringify(f.key);
        const optMark = f.optional ? '?' : '';
        let typeStr = formatType(f.type);
        if (f.nullable && !typeStr.includes('null')) {
          typeStr += ' | null';
        }
        lines.push(`  ${safeKey}${optMark}: ${typeStr};`);
      }
      lines.push('}');
    } else {
      lines.push(`${exportKeyword}type ${rootName} = {`);
      for (const f of fields) {
        const safeKey = isValidJsIdentifier(f.key) ? f.key : JSON.stringify(f.key);
        const optMark = f.optional ? '?' : '';
        let typeStr = formatType(f.type);
        if (f.nullable && !typeStr.includes('null')) {
          typeStr += ' | null';
        }
        lines.push(`  ${safeKey}${optMark}: ${typeStr};`);
      }
      lines.push('};');
    }
  } else {
    lines.push(`${exportKeyword}type ${rootName} = ${formatType(rootType)};`);
  }

  return lines.join('\n').trim() + '\n';
}

/**
 * 2. Zod Schema Generator
 */
export function generateZodSchema(
  data: unknown,
  options: TypeGenOptions = {}
): string {
  const rootName = toPascalCase(options.rootName || 'Root');
  const exportKeyword = options.exportKeyword !== false ? 'export ' : '';

  const analyzer = new TypeAnalyzer(rootName);
  const { rootType, models } = analyzer.analyze(data);

  const lines: string[] = ['import { z } from "zod";\n'];

  function formatZod(t: IntermediateType): string {
    switch (t.kind) {
      case 'primitive':
        if (t.primitive === 'integer') return 'z.number().int()';
        if (t.primitive === 'number') return 'z.number()';
        if (t.primitive === 'boolean') return 'z.boolean()';
        if (t.primitive === 'string') return 'z.string()';
        if (t.primitive === 'null') return 'z.null()';
        return 'z.any()';
      case 'object':
        return `${t.modelName}Schema`;
      case 'array':
        return `z.array(${formatZod(t.itemType)})`;
      case 'union':
        return `z.union([${t.types.map(formatZod).join(', ')}])`;
      case 'any':
      default:
        return 'z.any()';
    }
  }

  for (const m of models) {
    if (m.name === rootName && rootType.kind === 'object') {
      continue;
    }

    lines.push(`${exportKeyword}const ${m.name}Schema = z.object({`);
    for (const f of m.fields) {
      const safeKey = isValidJsIdentifier(f.key) ? f.key : JSON.stringify(f.key);
      let zodRule = formatZod(f.type);
      if (f.nullable) zodRule += '.nullable()';
      if (f.optional) zodRule += '.optional()';
      lines.push(`  ${safeKey}: ${zodRule},`);
    }
    lines.push('});');
    lines.push(`${exportKeyword}type ${m.name} = z.infer<typeof ${m.name}Schema>;\n`);
  }

  if (rootType.kind === 'object') {
    const rootModel = models.find(m => m.name === rootName);
    const fields = rootModel ? rootModel.fields : (rootType.fields || []);
    lines.push(`${exportKeyword}const ${rootName}Schema = z.object({`);
    for (const f of fields) {
      const safeKey = isValidJsIdentifier(f.key) ? f.key : JSON.stringify(f.key);
      let zodRule = formatZod(f.type);
      if (f.nullable) zodRule += '.nullable()';
      if (f.optional) zodRule += '.optional()';
      lines.push(`  ${safeKey}: ${zodRule},`);
    }
    lines.push('});');
  } else {
    lines.push(`${exportKeyword}const ${rootName}Schema = ${formatZod(rootType)};`);
  }
  lines.push(`${exportKeyword}type ${rootName} = z.infer<typeof ${rootName}Schema>;`);

  return lines.join('\n').trim() + '\n';
}

/**
 * 3. JSON Schema (Draft-07) Generator
 */
export function generateJsonSchema(
  data: unknown,
  options: TypeGenOptions = {}
): string {
  const rootName = toPascalCase(options.rootName || 'Root');
  const analyzer = new TypeAnalyzer(rootName);
  const { rootType } = analyzer.analyze(data);

  function toJsonSchemaNode(t: IntermediateType): Record<string, unknown> {
    switch (t.kind) {
      case 'primitive':
        if (t.primitive === 'integer') return { type: 'integer' };
        if (t.primitive === 'number') return { type: 'number' };
        if (t.primitive === 'boolean') return { type: 'boolean' };
        if (t.primitive === 'string') return { type: 'string' };
        if (t.primitive === 'null') return { type: 'null' };
        return {};
      case 'object': {
        const properties: Record<string, unknown> = {};
        const required: string[] = [];
        for (const f of t.fields) {
          const propSchema = toJsonSchemaNode(f.type);
          if (f.nullable) {
            if (propSchema.type) {
              propSchema.type = Array.isArray(propSchema.type)
                ? [...propSchema.type, 'null']
                : [propSchema.type, 'null'];
            }
          }
          properties[f.originalKey] = propSchema;
          if (!f.optional) {
            required.push(f.originalKey);
          }
        }
        const res: Record<string, unknown> = {
          type: 'object',
          properties
        };
        if (required.length > 0) {
          res.required = required;
        }
        return res;
      }
      case 'array':
        return {
          type: 'array',
          items: toJsonSchemaNode(t.itemType)
        };
      case 'union':
        return {
          anyOf: t.types.map(toJsonSchemaNode)
        };
      case 'any':
      default:
        return {};
    }
  }

  const rootSchemaNode = toJsonSchemaNode(rootType);
  const schema: Record<string, unknown> = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: rootName,
    ...rootSchemaNode
  };

  return JSON.stringify(schema, null, 2) + '\n';
}

/**
 * 4. Python Pydantic (v2) Generator
 */
export function generatePydantic(
  data: unknown,
  options: TypeGenOptions = {}
): string {
  const rootName = toPascalCase(options.rootName || 'Root');
  const useSnakeCase = options.useSnakeCase !== false;

  const analyzer = new TypeAnalyzer(rootName);
  const { rootType, models } = analyzer.analyze(data);

  const lines: string[] = [
    'from __future__ import annotations',
    'from typing import Any, Dict, List, Optional, Union',
    'from pydantic import BaseModel, Field\n'
  ];

  function formatPythonType(t: IntermediateType): string {
    switch (t.kind) {
      case 'primitive':
        if (t.primitive === 'integer') return 'int';
        if (t.primitive === 'number') return 'float';
        if (t.primitive === 'boolean') return 'bool';
        if (t.primitive === 'string') return 'str';
        if (t.primitive === 'null') return 'None';
        return 'Any';
      case 'object':
        return t.modelName;
      case 'array':
        return `List[${formatPythonType(t.itemType)}]`;
      case 'union':
        return `Union[${t.types.map(formatPythonType).join(', ')}]`;
      case 'any':
      default:
        return 'Any';
    }
  }

  function renderPydanticModel(name: string, fields: IntermediateField[]): string {
    const classLines: string[] = [`class ${name}(BaseModel):`];
    if (fields.length === 0) {
      classLines.push('    pass');
      return classLines.join('\n');
    }

    for (const f of fields) {
      let pyName = useSnakeCase ? toSnakeCase(f.key) : f.key;
      let needsAlias = false;

      if (isPythonKeyword(pyName)) {
        pyName = pyName + '_';
        needsAlias = true;
      }
      if (pyName !== f.originalKey) {
        needsAlias = true;
      }

      const rawType = formatPythonType(f.type);
      const isNullableOrOptional = f.optional || f.nullable;
      const typeStr = isNullableOrOptional ? `Optional[${rawType}]` : rawType;

      let fieldDecl = `    ${pyName}: ${typeStr}`;
      if (needsAlias && isNullableOrOptional) {
        fieldDecl += ` = Field(default=None, alias="${f.originalKey}")`;
      } else if (needsAlias) {
        fieldDecl += ` = Field(alias="${f.originalKey}")`;
      } else if (isNullableOrOptional) {
        fieldDecl += ' = None';
      }

      classLines.push(fieldDecl);
    }

    return classLines.join('\n');
  }

  // Render dependent models in topological order
  for (const m of models) {
    if (m.name === rootName && rootType.kind === 'object') {
      continue;
    }
    lines.push(renderPydanticModel(m.name, m.fields));
    lines.push('');
  }

  // Render Root
  if (rootType.kind === 'object') {
    const rootModel = models.find(m => m.name === rootName);
    const fields = rootModel ? rootModel.fields : (rootType.fields || []);
    lines.push(renderPydanticModel(rootName, fields));
  } else {
    lines.push(`${rootName} = ${formatPythonType(rootType)}`);
  }

  return lines.join('\n').trim() + '\n';
}

/**
 * 5. Python Dataclass Generator
 */
export function generatePythonDataclass(
  data: unknown,
  options: TypeGenOptions = {}
): string {
  const rootName = toPascalCase(options.rootName || 'Root');
  const useSnakeCase = options.useSnakeCase !== false;

  const analyzer = new TypeAnalyzer(rootName);
  const { rootType, models } = analyzer.analyze(data);

  const lines: string[] = [
    'from __future__ import annotations',
    'from dataclasses import dataclass, field',
    'from typing import Any, Dict, List, Optional, Union\n'
  ];

  function formatPythonType(t: IntermediateType): string {
    switch (t.kind) {
      case 'primitive':
        if (t.primitive === 'integer') return 'int';
        if (t.primitive === 'number') return 'float';
        if (t.primitive === 'boolean') return 'bool';
        if (t.primitive === 'string') return 'str';
        if (t.primitive === 'null') return 'None';
        return 'Any';
      case 'object':
        return t.modelName;
      case 'array':
        return `List[${formatPythonType(t.itemType)}]`;
      case 'union':
        return `Union[${t.types.map(formatPythonType).join(', ')}]`;
      case 'any':
      default:
        return 'Any';
    }
  }

  function renderDataclassModel(name: string, fields: IntermediateField[]): string {
    const classLines: string[] = ['@dataclass', `class ${name}:`];
    if (fields.length === 0) {
      classLines.push('    pass');
      return classLines.join('\n');
    }

    // In Python dataclasses, non-default arguments MUST precede default arguments!
    const requiredFields = fields.filter(f => !f.optional && !f.nullable);
    const defaultFields = fields.filter(f => f.optional || f.nullable);
    const sortedFields = [...requiredFields, ...defaultFields];

    for (const f of sortedFields) {
      let pyName = useSnakeCase ? toSnakeCase(f.key) : f.key;
      if (isPythonKeyword(pyName)) {
        pyName = pyName + '_';
      }

      const rawType = formatPythonType(f.type);
      const isNullableOrOptional = f.optional || f.nullable;
      const typeStr = isNullableOrOptional ? `Optional[${rawType}]` : rawType;

      let fieldDecl = `    ${pyName}: ${typeStr}`;
      if (isNullableOrOptional) {
        fieldDecl += ' = None';
      }

      classLines.push(fieldDecl);
    }

    return classLines.join('\n');
  }

  for (const m of models) {
    if (m.name === rootName && rootType.kind === 'object') {
      continue;
    }
    lines.push(renderDataclassModel(m.name, m.fields));
    lines.push('');
  }

  if (rootType.kind === 'object') {
    const rootModel = models.find(m => m.name === rootName);
    const fields = rootModel ? rootModel.fields : (rootType.fields || []);
    lines.push(renderDataclassModel(rootName, fields));
  } else {
    lines.push(`${rootName} = ${formatPythonType(rootType)}`);
  }

  return lines.join('\n').trim() + '\n';
}

/**
 * Universal Contract Dispatcher
 */
export function generateContract(
  data: unknown,
  target: ContractTarget,
  options: TypeGenOptions = {}
): string {
  const norm = (target || 'typescript').toLowerCase() as ContractTarget;
  switch (norm) {
    case 'zod':
      return generateZodSchema(data, options);
    case 'json-schema':
      return generateJsonSchema(data, options);
    case 'pydantic':
      return generatePydantic(data, options);
    case 'dataclass':
      return generatePythonDataclass(data, options);
    case 'typescript':
    case 'ts':
    default:
      return generateTypeScript(data, options);
  }
}
