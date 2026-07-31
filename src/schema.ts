import { PropertyInfo, SchemaInfo } from './types';

// Schema inference functions
export function detectType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value;
}

export function unionTypes(type1: string | string[], type2: string | string[]): string | string[] {
  const types1 = Array.isArray(type1) ? type1 : [type1];
  const types2 = Array.isArray(type2) ? type2 : [type2];
  const combined = [...new Set([...types1, ...types2])];
  return combined.length === 1 ? combined[0] : combined;
}

export function inferSchemaFromData(data: unknown): SchemaInfo | null {
  if (data === null || data === undefined) {
    return { type: 'primitive', valueType: 'null' };
  }

  // Handle arrays
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return { type: 'array', items: { type: 'primitive', valueType: 'any' } };
    }

    // Sample up to 20 items for efficiency
    const sample = data.slice(0, Math.min(20, data.length));
    const sampleTypes = sample.map(detectType);
    const uniqueTypes = [...new Set(sampleTypes)];

    // If all items are objects, merge their properties
    if (uniqueTypes.length === 1 && uniqueTypes[0] === 'object') {
      const mergedProperties: Record<string, PropertyInfo> = {};
      const propertyCounts: Record<string, number> = {};

      for (const item of sample) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const keys = Object.keys(item);
          for (const key of keys) {
            if (!mergedProperties[key]) {
              mergedProperties[key] = {
                name: key,
                type: detectType(item[key]),
                optional: false
              };
              propertyCounts[key] = 1;

              // Recursively infer nested structures
              if (Array.isArray(item[key])) {
                const inferred = inferSchemaFromData(item[key]);
                mergedProperties[key].items = inferred || undefined;
                mergedProperties[key].type = 'array';
              } else if (item[key] && typeof item[key] === 'object') {
                const nestedSchema = inferSchemaFromData(item[key]);
                if (nestedSchema && nestedSchema.properties) {
                  mergedProperties[key].properties = nestedSchema.properties;
                  mergedProperties[key].type = 'object';
                }
              }
            } else {
              propertyCounts[key] = (propertyCounts[key] || 0) + 1;
              // Merge types if different
              const currentType = detectType(item[key]);
              mergedProperties[key].type = unionTypes(mergedProperties[key].type, currentType);

              // Update nested structures if present
              if (Array.isArray(item[key])) {
                const itemSchema = inferSchemaFromData(item[key]);
                if (itemSchema) {
                  mergedProperties[key].items = itemSchema.items || itemSchema;
                  mergedProperties[key].type = 'array';
                }
              } else if (item[key] && typeof item[key] === 'object') {
                const nestedSchema = inferSchemaFromData(item[key]);
                if (nestedSchema && nestedSchema.properties) {
                  // Merge nested properties
                  if (!mergedProperties[key].properties) {
                    mergedProperties[key].properties = nestedSchema.properties;
                  } else {
                    for (const [nestedKey, nestedProp] of Object.entries(nestedSchema.properties)) {
                      if (!mergedProperties[key].properties![nestedKey]) {
                        mergedProperties[key].properties![nestedKey] = nestedProp;
                      } else {
                        mergedProperties[key].properties![nestedKey].type = unionTypes(
                          mergedProperties[key].properties![nestedKey].type,
                          nestedProp.type
                        );
                      }
                    }
                  }
                  mergedProperties[key].type = 'object';
                }
              }
            }
          }
        }
      }

      // Mark properties as optional if they don't appear in all items
      const totalItems = sample.length;
      for (const key of Object.keys(mergedProperties)) {
        if (propertyCounts[key] < totalItems) {
          mergedProperties[key].optional = true;
        }
      }

      return {
        type: 'array',
        items: {
          type: 'object',
          properties: mergedProperties
        }
      };
    }

    // If all items are same primitive type
    if (uniqueTypes.length === 1) {
      const itemType = uniqueTypes[0];
      if (itemType !== 'object' && itemType !== 'array') {
        return {
          type: 'array',
          items: { type: 'primitive', valueType: itemType }
        };
      }
    }

    // Mixed types - return union or any
    if (uniqueTypes.length <= 3) {
      return {
        type: 'array',
        items: { type: 'primitive', valueType: uniqueTypes }
      };
    }

    return { type: 'array', items: { type: 'primitive', valueType: 'any' } };
  }

  // Handle objects
  if (typeof data === 'object' && data !== null) {
    const properties: Record<string, PropertyInfo> = {};
    const keys = Object.keys(data);

    for (const key of keys) {
      const value = (data as Record<string, unknown>)[key];
      properties[key] = {
        name: key,
        type: detectType(value)
      };

      // Recursively infer nested structures
      if (Array.isArray(value)) {
        const inferred = inferSchemaFromData(value);
        properties[key].items = inferred || undefined;
        properties[key].type = 'array';
      } else if (value && typeof value === 'object') {
        const nestedSchema = inferSchemaFromData(value);
        if (nestedSchema && nestedSchema.properties) {
          properties[key].properties = nestedSchema.properties;
          properties[key].type = 'object';
        }
      }
    }

    return { type: 'object', properties };
  }

  // Handle primitives
  return { type: 'primitive', valueType: detectType(data) };
}
