import CommandLineArgs, {OptionDefinition} from 'command-line-args';
import { bundleOpenApiSpec } from 'openapi-ref-resolver';
import {BaseOptions, GenerateFunction} from "../types/generator";

export const BASE_OPTION_DEFINITIONS: OptionDefinition[] = [
  { name: 'spec-file', type: String },
  { name: 'output-dir', type: String, defaultValue: 'gen' },
]

export const runGenerator = <T extends BaseOptions> (options: T, generateFunc: GenerateFunction) => {
  const bundled = bundleOpenApiSpec(options.specFile);
  generateFunc(bundled.document, options);
};

export const parseCliArguments = <T extends BaseOptions> (optionsDefinitions: OptionDefinition[]): T => {
  const args = CommandLineArgs([
    ...BASE_OPTION_DEFINITIONS,
    ...optionsDefinitions,
  ], {
    camelCase: true,
  });
  return <T> args;
};
