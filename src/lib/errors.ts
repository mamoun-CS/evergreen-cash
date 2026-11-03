export class AppError extends Error {
  readonly code: string;
  readonly userMessage: string;

  constructor(code: string, userMessage: string, message = userMessage) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

export class ValidationError extends AppError {
  constructor(userMessage: string, code = "VALIDATION") {
    super(code, userMessage);
    this.name = "ValidationError";
  }
}

export class IntegrityError extends AppError {
  constructor(userMessage: string, code = "INTEGRITY") {
    super(code, userMessage);
    this.name = "IntegrityError";
  }
}

export function toUserMessage(error: unknown): string {
  if (error instanceof AppError) return error.userMessage;
  if (error instanceof Error) return error.message;
  return "حدث خطأ غير متوقع.";
}
