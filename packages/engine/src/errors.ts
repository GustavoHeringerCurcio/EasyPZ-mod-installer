export type EasyPzErrorCode =
  | 'GAME_NOT_FOUND'
  | 'GAME_RUNNING'
  | 'ELEVATION_REQUIRED'
  | 'DISK_SPACE'
  | 'ARCHIVE_HASH_MISMATCH'
  | 'ARCHIVE_CORRUPT'
  | 'ARCHIVE_MISSING_MODS'
  | 'NOT_INSTALLED'
  | 'MISSING_MODS'
  | 'HOST_NOT_FOUND'
  | 'CANCELLED'
  | 'PATH_NOT_WRITABLE'
  | 'IO'

export class EasyPzError extends Error {
  readonly code: EasyPzErrorCode

  constructor(code: EasyPzErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EasyPzError'
    this.code = code
  }
}

export function isEasyPzError(error: unknown): error is EasyPzError {
  return error instanceof EasyPzError
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function cancelledError(): EasyPzError {
  return new EasyPzError('CANCELLED', 'The operation was cancelled.')
}
