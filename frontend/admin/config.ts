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
import type { Features } from "./features.ts";
const features = {} as Features;
features.api = createApi(features);
features.notifications = createNotifications(features);
features.actions = createActions(features);
features.nativeLinks = createNativeLinks(features);
features.table = createTable(features);
features.rules = createRules(features);
features.identities = createIdentities(features);
features.navigation = createNavigation(features);
features.managerUi = createManagerUi(features);
features.changes = createChanges(features);
features.review = createReview(features);
features.rowMenu = createRowMenu(features);
features.bulk = createBulk(features);
features.issues = createIssues(features);
features.issueGuidance = createIssueGuidance(features);
features.bootstrap = createBootstrap(features);
// Register every feature before wiring controls that call another feature.
for (const feature of [
    features.nativeLinks,
    features.table,
    features.rules,
    features.identities,
    features.navigation,
    features.managerUi,
    features.changes,
    features.review,
    features.rowMenu,
    features.bulk,
    features.issues,
    features.issueGuidance,
    features.bootstrap,
])
    feature.initialize();
