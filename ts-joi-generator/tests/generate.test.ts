import { bundleOpenApiSpec } from 'openapi-ref-resolver';
import { generate as generateTypes } from '../src/generator';

describe('generate', () => {
  it('generate types', () => {
    const bundled = bundleOpenApiSpec(__dirname + '/api.yaml');
    generateTypes(bundled.document);
  });
});
