import { Model, Operation } from './model';
import { Dict } from './common';
import {OpenApiNode} from "openapi-ref-resolver";

export interface GenerationContext {
  models: Dict<Model>;
  operations: Dict<Operation[]>;
}

export interface BaseOptions extends Dict {
  specFile: string,
  outputDir: string;
}

export type GenerateFunction = (spec: OpenApiNode, options: Dict) => void;
