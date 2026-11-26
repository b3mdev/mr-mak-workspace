import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const error = (message, status) => Object.assign(new Error(message), { status });

export async function localPath(base, value) {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f]/.test(value)) throw error('Choose a local file or folder.', 400);
  if (/^file:/i.test(value)) {
    try { value = fileURLToPath(value); }
    catch { throw error('Choose a valid local file URL.', 400); }
  }
  if (/[\x00-\x1f]/.test(value)) throw error('Choose a local file or folder.', 400);
  try { return await realpath(path.resolve(base, value)); }
  catch (failure) {
    if (['ENOENT', 'ENOTDIR'].includes(failure.code)) throw error('The file or folder was not found. It may have been moved or renamed.', 404);
    throw failure;
  }
}
