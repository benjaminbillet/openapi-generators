import { OpenApiNode } from 'openapi-ref-resolver';
import { isArray, isComposition, isEnum, isObject, isPrimitive, isReference } from '../openapi/v3/schema';
import { Dict } from '../types/common';
import { CompositionType } from '../openapi/v3/types';
import { capitalize } from '../util/misc';
import {
  ArrayModel,
  CompositionModel,
  DiscriminatedModel,
  Model,
  ModelType,
  ObjectModel,
  PrimitiveModel,
} from '../types/model';
import { escapeName, getNameFromRef, ModelRegistry } from './model-registry';
import { resolveReference } from '../util/document';

const processComposition = (
  modelRegistry: ModelRegistry,
  document: OpenApiNode,
  schema: OpenApiNode,
  parentName: string,
  name?: string,
): CompositionModel => {
  const compositionType = Object.values(CompositionType).find((compositionType) => schema[compositionType] != null);
  if (compositionType == null) {
    throw new Error('Unknown composition type');
  }

  const myName = name || `${parentName}${capitalize(compositionType)}`;
  const dependencies: Model[] = [];

  const refToIndex: Dict<number> = {};
  const subSchemas: CompositionModel['subSchemas'] = schema[compositionType].map(
    (subSchema: OpenApiNode, index: number) => {
      if (isReference(subSchema)) {
        refToIndex[subSchema.$ref] = index;
        const itemType = getNameFromRef(subSchema.$ref);
        return processSchema(modelRegistry, document, subSchema, myName, itemType);
      } else if (isPrimitive(subSchema)) {
        return processSchema(modelRegistry, document, subSchema, myName);
      }
      let suffix = 'Option';
      if (compositionType === 'allOf') {
        suffix = 'Part';
      }
      return processSchema(modelRegistry, document, subSchema, myName, myName + suffix + (index + 1));
    },
  );
  dependencies.push(...subSchemas);

  let discriminator;
  let hasMapping = false;
  if (schema.discriminator) {
    discriminator = schema.discriminator.propertyName;
    if (schema.discriminator.mapping) {
      hasMapping = true;
      Object.entries(schema.discriminator.mapping).forEach(([value, ref]: any) => {
        let index = refToIndex[ref];
        if (index == null) {
          // reference to a composition branch
          index = ref.split('/').pop();
        }
        if (index != null) {
          subSchemas[index] = {
            ...subSchemas[index],
            discriminatorValue: value,
          };
        }
      });
    }
  }
  return {
    ...schema,
    modelType: ModelType.COMPOSITION,
    name: myName,
    compositionType,
    discriminator,
    hasMapping,
    subSchemas,
    mappedSubSchemas: subSchemas.filter((s): s is DiscriminatedModel => s.discriminatorValue != null),
    unmappedSubSchemas: subSchemas.filter((s): s is Model => s.discriminatorValue == null),
    dependencies,
  };
};

const processPrimitive = (schema: OpenApiNode, parentName: string, name?: string): PrimitiveModel => {
  const myName = name || (isEnum(schema) ? parentName + 'Enum' : parentName + capitalize(schema.format || schema.type));
  // TODO composition of primitives
  return {
    ...schema,
    modelType: ModelType.PRIMITIVE,
    name: myName,
    dependencies: [],
  };
};

const processArray = (
  modelRegistry: ModelRegistry,
  document: OpenApiNode,
  schema: OpenApiNode,
  parentName: string,
  name?: string,
): ArrayModel => {
  const myName = name || `${parentName}Array`;
  const dependencies: Model[] = [];

  let itemModel;
  if (schema.items) {
    if (isReference(schema.items)) {
      const itemType = getNameFromRef(schema.items.$ref);
      itemModel = processSchema(modelRegistry, document, schema.items, myName, itemType);
    } else if (isPrimitive(schema.items)) {
      itemModel = processSchema(modelRegistry, document, schema.items, myName);
    } else {
      itemModel = processSchema(modelRegistry, document, schema.items, myName, myName + 'Item');
    }
    dependencies.push(itemModel);
  }
  // TODO composition of arrays
  return {
    ...schema,
    modelType: ModelType.ARRAY,
    name: myName,
    items: itemModel,
    dependencies,
  };
};

export const processObject = (
  modelRegistry: ModelRegistry,
  document: OpenApiNode,
  schema: OpenApiNode,
  parentName: string,
  name?: string,
): ObjectModel => {
  const myName = name || `${parentName}Object`;
  const dependencies: Model[] = [];

  const properties: ObjectModel['properties'] = Object.entries(schema.properties || []).map(([propName, prop]: any) => {
    let propModel;
    if (isReference(prop)) {
      const propType = getNameFromRef(prop.$ref);
      propModel = processSchema(modelRegistry, document, prop, myName, propType);
    } else if (isPrimitive(prop)) {
      propModel = processSchema(modelRegistry, document, prop, myName);
    } else {
      propModel = processSchema(modelRegistry, document, prop, myName, myName + escapeName(propName));
    }
    dependencies.push(propModel);
    return {
      ...propModel,
      required: Boolean((schema.required && schema.required.includes(propName)) || propModel.default != null),
      propName: propName,
    };
  });

  const { additionalProperties, ...schemaRest } = schema;
  const model: ObjectModel = {
    ...schemaRest,
    modelType: ModelType.OBJECT,
    name: myName,
    properties,
    dependencies,
  };

  if (additionalProperties && typeof additionalProperties === 'object') {
    if (isReference(additionalProperties)) {
      const propType = getNameFromRef(additionalProperties.$ref);
      model.additionalProperties = processSchema(modelRegistry, document, additionalProperties, myName, propType);
    } else if (isPrimitive(additionalProperties)) {
      model.additionalProperties = processSchema(modelRegistry, document, schema.additionalProperties, myName);
    } else {
      model.additionalProperties = processSchema(
        modelRegistry,
        document,
        additionalProperties,
        myName,
        myName + 'Item',
      );
    }
    model.dependencies.push(model.additionalProperties);
  }
  if (isComposition(schema)) {
    model.composition = processComposition(modelRegistry, document, schema, myName);
    model.dependencies.push(model.composition);
  } else if (additionalProperties && schema.properties == null) {
    model.isDictionary = true;
  }
  if (additionalProperties === true) {
    model.hasAnyAdditionalProperties = true;
  }
  if (model.composition == null && schema.additionalProperties == null) {
    model.interface = true;
  }

  return model;
};

const processSchema = (
  modelRegistry: ModelRegistry,
  document: OpenApiNode,
  schema: OpenApiNode,
  parentName: string,
  name?: string,
): Model => {
  if (name && modelRegistry.hasModel(name)) {
    return modelRegistry.getModel(name);
  }
  const resolved = resolveReference(document, schema);

  let model: any;
  if (isPrimitive(resolved)) {
    model = processPrimitive(resolved, parentName, name);
  } else if (isArray(resolved)) {
    model = processArray(modelRegistry, document, resolved, parentName, name);
  } else if (isObject(resolved)) {
    model = processObject(modelRegistry, document, resolved, parentName, name);
  } else if (isComposition(resolved)) {
    model = processComposition(modelRegistry, document, resolved, parentName, name);
  }

  if (isReference(schema)) {
    model.ref = schema.$ref;
  }

  if (model && model.name) {
    modelRegistry.registerModel(model.name, model);
  }
  if (model && model.composition && model.composition.name) {
    modelRegistry.registerModel(model.composition.name, model.composition);
  }
  return model;
};

export const processModel = (
  spec: OpenApiNode,
  modelName: string,
  schema: OpenApiNode,
  modelRegistry: ModelRegistry,
) => {
  return processSchema(modelRegistry, spec, schema, '', modelName);
};

export const processModels = (spec: OpenApiNode, modelRegistry?: ModelRegistry) => {
  const registry = modelRegistry || new ModelRegistry();
  Object.entries(spec.components.schemas).forEach(([name, schema]: any) => {
    processModel(spec, escapeName(name), schema, registry);
  });
  return registry;
};
