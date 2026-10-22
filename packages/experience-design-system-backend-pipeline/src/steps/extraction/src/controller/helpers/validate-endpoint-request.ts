import type { ExtractionEndpointRequest } from '../../types/contract.js';

export function validateRequest(request: ExtractionEndpointRequest): void {
  if (request === null || typeof request !== 'object') {
    throw new TypeError('extractEndpoint requires a request object');
  }

  if (!Array.isArray(request.filePaths)) {
    throw new TypeError('extractEndpoint requires filePaths to be an array');
  }

  if (request.filePaths.some((filePath) => typeof filePath !== 'string' || filePath.trim().length === 0)) {
    throw new TypeError('extractEndpoint requires filePaths to contain non-empty strings');
  }

  if (
    request.projectRoot !== undefined &&
    (typeof request.projectRoot !== 'string' || request.projectRoot.trim().length === 0)
  ) {
    throw new TypeError('extractEndpoint requires projectRoot to be a non-empty string when provided');
  }

  if (
    request.resolveUnreachable !== undefined &&
    request.resolveUnreachable !== 'auto' &&
    request.resolveUnreachable !== 'always' &&
    request.resolveUnreachable !== 'never'
  ) {
    throw new TypeError("extractEndpoint requires resolveUnreachable to be 'auto', 'always', or 'never'");
  }

  if (request.onProgress !== undefined && typeof request.onProgress !== 'function') {
    throw new TypeError('extractEndpoint requires onProgress to be a function when provided');
  }
}
