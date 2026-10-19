import type { Issue, RepairQueue } from "./responses.ts";
import type { ApplicationReport } from "./contracts.ts";
export function createIssuesSession() {
    let issueItems: Issue[] = [],
        issueArchived: ApplicationReport[] = [],
        issueStart = 0,
        issueBusy = false;
    let repairQueue: RepairQueue | null = null;
    const issueSelection = new Set<string>();
    return {
        get issueSelection() {
            return issueSelection;
        },
        get issueItems() {
            return issueItems;
        },
        set issueItems(value: typeof issueItems) {
            issueItems = value;
        },
        get issueArchived() {
            return issueArchived;
        },
        set issueArchived(value: typeof issueArchived) {
            issueArchived = value;
        },
        get issueStart() {
            return issueStart;
        },
        set issueStart(value: typeof issueStart) {
            issueStart = value;
        },
        get issueBusy() {
            return issueBusy;
        },
        set issueBusy(value: typeof issueBusy) {
            issueBusy = value;
        },
        get repairQueue() {
            return repairQueue;
        },
        set repairQueue(value: typeof repairQueue) {
            repairQueue = value;
        },
    };
}
