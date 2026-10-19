import { createApi } from "./api.ts";
import { createNotifications } from "./notifications.ts";
import { createActions } from "./actions.ts";
import { createNativeLinks } from "./nativeLinks.ts";
import { createTable } from "./table.ts";
import { createRules } from "./rules.ts";
import { createIdentities } from "./identities.ts";
import { createNavigation } from "./navigation.ts";
import { createManagerUi } from "./managerUi.ts";
import { createChanges } from "./changes.ts";
import { createReview } from "./review.ts";
import { createRowMenu } from "./rowMenu.ts";
import { createBulk } from "./bulk.ts";
import { createIssues } from "./issues.ts";
import { createIssueGuidance } from "./issueGuidance.ts";
import { createBootstrap } from "./bootstrap.ts";
import { createDashboardState } from "./dashboardState.ts";
const session = createDashboardState();
const api: ReturnType<typeof createApi> = createApi(
    {
        get actions() {
            return actions;
        },
        get notifications() {
            return notifications;
        },
    },
    session,
);
const notifications: ReturnType<typeof createNotifications> = createNotifications(
    {
        get api() {
            return api;
        },
        get navigation() {
            return navigation;
        },
        get issueGuidance() {
            return issueGuidance;
        },
        get managerUi() {
            return managerUi;
        },
        get actions() {
            return actions;
        },
    },
    session,
);
const actions: ReturnType<typeof createActions> = createActions(
    {
        get api() {
            return api;
        },
        get managerUi() {
            return managerUi;
        },
        get bulk() {
            return bulk;
        },
        get issues() {
            return issues;
        },
    },
    session,
);
const nativeLinks: ReturnType<typeof createNativeLinks> = createNativeLinks(
    {
        get api() {
            return api;
        },
    },
    session,
);
const table: ReturnType<typeof createTable> = createTable({
    get api() {
        return api;
    },
    get navigation() {
        return navigation;
    },
});
const rules: ReturnType<typeof createRules> = createRules(
    {
        get api() {
            return api;
        },
        get actions() {
            return actions;
        },
        get notifications() {
            return notifications;
        },
        get managerUi() {
            return managerUi;
        },
        get navigation() {
            return navigation;
        },
    },
    session,
);
const identities: ReturnType<typeof createIdentities> = createIdentities(
    {
        get rules() {
            return rules;
        },
        get api() {
            return api;
        },
        get notifications() {
            return notifications;
        },
    },
    session,
);
const navigation: ReturnType<typeof createNavigation> = createNavigation(
    {
        get rules() {
            return rules;
        },
        get api() {
            return api;
        },
        get managerUi() {
            return managerUi;
        },
        get identities() {
            return identities;
        },
        get notifications() {
            return notifications;
        },
        get issueGuidance() {
            return issueGuidance;
        },
        get rowMenu() {
            return rowMenu;
        },
        get issues() {
            return issues;
        },
        get changes() {
            return changes;
        },
        get nativeLinks() {
            return nativeLinks;
        },
    },
    session,
);
const managerUi: ReturnType<typeof createManagerUi> = createManagerUi(
    {
        get navigation() {
            return navigation;
        },
        get api() {
            return api;
        },
        get rowMenu() {
            return rowMenu;
        },
        get table() {
            return table;
        },
        get nativeLinks() {
            return nativeLinks;
        },
        get notifications() {
            return notifications;
        },
        get rules() {
            return rules;
        },
        get issueGuidance() {
            return issueGuidance;
        },
        get changes() {
            return changes;
        },
        get identities() {
            return identities;
        },
        get issues() {
            return issues;
        },
    },
    session,
);
const changes: ReturnType<typeof createChanges> = createChanges(
    {
        get nativeLinks() {
            return nativeLinks;
        },
        get table() {
            return table;
        },
        get api() {
            return api;
        },
        get rowMenu() {
            return rowMenu;
        },
        get rules() {
            return rules;
        },
        get identities() {
            return identities;
        },
        get managerUi() {
            return managerUi;
        },
        get bulk() {
            return bulk;
        },
        get navigation() {
            return navigation;
        },
        get notifications() {
            return notifications;
        },
    },
    session,
);
const review: ReturnType<typeof createReview> = createReview(
    {
        get api() {
            return api;
        },
        get navigation() {
            return navigation;
        },
        get notifications() {
            return notifications;
        },
        get actions() {
            return actions;
        },
        get managerUi() {
            return managerUi;
        },
        get issueGuidance() {
            return issueGuidance;
        },
        get rules() {
            return rules;
        },
        get bulk() {
            return bulk;
        },
        get issues() {
            return issues;
        },
        get nativeLinks() {
            return nativeLinks;
        },
    },
    session,
);
const rowMenu: ReturnType<typeof createRowMenu> = createRowMenu(
    {
        get api() {
            return api;
        },
        get navigation() {
            return navigation;
        },
    },
    session,
);
const bulk: ReturnType<typeof createBulk> = createBulk(
    {
        get api() {
            return api;
        },
        get notifications() {
            return notifications;
        },
        get rules() {
            return rules;
        },
    },
    session,
);
const issues: ReturnType<typeof createIssues> = createIssues(
    {
        get api() {
            return api;
        },
        get rowMenu() {
            return rowMenu;
        },
        get table() {
            return table;
        },
        get navigation() {
            return navigation;
        },
        get nativeLinks() {
            return nativeLinks;
        },
        get notifications() {
            return notifications;
        },
        get rules() {
            return rules;
        },
        get issueGuidance() {
            return issueGuidance;
        },
        get identities() {
            return identities;
        },
        get managerUi() {
            return managerUi;
        },
    },
    session,
);
const issueGuidance: ReturnType<typeof createIssueGuidance> = createIssueGuidance(
    {
        get navigation() {
            return navigation;
        },
        get api() {
            return api;
        },
        get nativeLinks() {
            return nativeLinks;
        },
        get rules() {
            return rules;
        },
        get identities() {
            return identities;
        },
        get managerUi() {
            return managerUi;
        },
        get issues() {
            return issues;
        },
        get actions() {
            return actions;
        },
        get notifications() {
            return notifications;
        },
    },
    session,
);
const bootstrap: ReturnType<typeof createBootstrap> = createBootstrap(
    {
        get rules() {
            return rules;
        },
        get actions() {
            return actions;
        },
        get api() {
            return api;
        },
        get navigation() {
            return navigation;
        },
        get nativeLinks() {
            return nativeLinks;
        },
        get notifications() {
            return notifications;
        },
        get identities() {
            return identities;
        },
        get managerUi() {
            return managerUi;
        },
    },
    session,
);
for (const controller of [
    nativeLinks,
    table,
    rules,
    identities,
    navigation,
    managerUi,
    changes,
    review,
    rowMenu,
    bulk,
    issues,
    issueGuidance,
    bootstrap,
])
    controller.initialize();
