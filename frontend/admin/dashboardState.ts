import { createDocumentState } from "./documentState.ts";
import { createBulkSession } from "./bulkSession.ts";
import { createChangesSession } from "./changesSession.ts";
import { createGuidanceSession } from "./guidanceSession.ts";
import { createIssuesSession } from "./issuesSession.ts";
import { createMetadataSession } from "./metadataSession.ts";
import { createLinkSession } from "./linkSession.ts";
import { createEditorSession } from "./editorSession.ts";
import { createRowMenuSession } from "./rowMenuSession.ts";
export function createDashboardState() {
    return {
        api: createDocumentState(),
        bulk: createBulkSession(),
        changes: createChangesSession(),
        issueGuidance: createGuidanceSession(),
        issues: createIssuesSession(),
        managerUi: createMetadataSession(),
        nativeLinks: createLinkSession(),
        navigation: createEditorSession(),
        rowMenu: createRowMenuSession(),
    };
}
export type DashboardState = ReturnType<typeof createDashboardState>;
