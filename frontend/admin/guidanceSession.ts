import type { Issue, IssueVerification } from "./responses.ts";
export function createGuidanceSession() {
    let issuePanelState: {
        issue: Issue;
        guided: boolean;
        request: number;
    } | null = null;
    let issueEditor: {
        issue: Issue;
        guided: boolean;
        choice: string;
        full: boolean;
        key: string;
    } | null = null;
    let issueVerification: IssueVerification | null = null;
    let issueCheckTimer: ReturnType<typeof setTimeout> | null = null,
        issueCheckSerial = 0;
    return {
        get issuePanelState() {
            return issuePanelState;
        },
        set issuePanelState(value: typeof issuePanelState) {
            issuePanelState = value;
        },
        get issueEditor() {
            return issueEditor;
        },
        set issueEditor(value: typeof issueEditor) {
            issueEditor = value;
        },
        get issueVerification() {
            return issueVerification;
        },
        set issueVerification(value: typeof issueVerification) {
            issueVerification = value;
        },
        get issueCheckTimer() {
            return issueCheckTimer;
        },
        set issueCheckTimer(value: typeof issueCheckTimer) {
            issueCheckTimer = value;
        },
        get issueCheckSerial() {
            return issueCheckSerial;
        },
        set issueCheckSerial(value: typeof issueCheckSerial) {
            issueCheckSerial = value;
        },
    };
}
