/** Errors carrying an HTTP status; mapped to responses by the REST error middleware and to hub errors. */
export class AppError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

export const notFound = (what: string) => new AppError(`${what} not found`, 404);
export const forbidden = (msg = 'Permission denied') => new AppError(msg, 403);
export const badRequest = (msg: string) => new AppError(msg, 400);
