import { mergeBatch, ulidToTraceId, type GuardResult, type OtlpAttribute, type OtlpPayload } from "@pinta-ai/core";
export { mergeBatch, ulidToTraceId };
export type { OtlpAttribute, OtlpPayload };
export declare function buildOtlpPayload(args: {
    name: string;
    traceId: string;
    fields: Record<string, unknown>;
    serviceVersion: string;
    now?: number;
    guard?: GuardResult | null;
}): OtlpPayload;
