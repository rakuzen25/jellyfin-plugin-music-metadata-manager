/** Auxiliary caches do not commit reviewed configuration or native metadata. */
export function isWriteRequest(path: string, method: string) {
    if (method.toUpperCase() === "GET") return false;
    const route = path.split("?")[0];
    return (
        !["preview", "validate", "manager/compare", "manager/images/cache", "manager/images/upload"].includes(route!) &&
        !/^manager\/items\/[^/]+\/images\/[^/]+\/pin-current$/.test(route!)
    );
}
