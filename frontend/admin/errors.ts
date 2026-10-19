export class OperationError extends Error {
    uncertainWrite = false;
    noticeHandled = false;
}
export function operationError(cause: unknown): OperationError {
    if (cause instanceof Error) return cause as OperationError;
    return new OperationError(String(cause));
}
interface TransportError {
    responseText?: string;
    status?: number;
    message?: string;
    text?: () => Promise<string>;
    clone?: () => TransportError;
}
export function transportError(cause: unknown): TransportError {
    if (cause && typeof cause === "object") return cause as TransportError;
    return { message: String(cause) };
}
