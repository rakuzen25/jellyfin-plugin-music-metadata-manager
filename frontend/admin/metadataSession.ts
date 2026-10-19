import type { ManagerDetails, Comparison } from "./responses.ts";
import type { MetadataPolicy } from "./contracts.ts";
export function createMetadataSession() {
    let managerStart = 0;
    let managerDetails: ManagerDetails, managerPolicy: MetadataPolicy;
    let managerComparison: Comparison | null = null,
        managerBatch: MetadataPolicy[] = [];
    return {
        get managerStart() {
            return managerStart;
        },
        set managerStart(value: typeof managerStart) {
            managerStart = value;
        },
        get managerDetails() {
            return managerDetails;
        },
        set managerDetails(value: typeof managerDetails) {
            managerDetails = value;
        },
        get managerPolicy() {
            return managerPolicy;
        },
        set managerPolicy(value: typeof managerPolicy) {
            managerPolicy = value;
        },
        get managerComparison() {
            return managerComparison;
        },
        set managerComparison(value: typeof managerComparison) {
            managerComparison = value;
        },
        get managerBatch() {
            return managerBatch;
        },
        set managerBatch(value: typeof managerBatch) {
            managerBatch = value;
        },
    };
}
