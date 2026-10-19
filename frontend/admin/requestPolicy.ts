/** Preview and comparison POSTs do not commit plugin state. */
export function isWriteRequest(path: string, method: string) {
    return method !== "GET" && !/^(preview|manager\/compare|manager\/images\/|manager\/items\/.+\/images\/)/.test(path);
}
