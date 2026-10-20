/** Jellyfin supplies this authenticated client to embedded configuration pages. */
declare const ApiClient: {
    ajax(options: { url: string; type: string; data?: string; contentType: string; dataType: string }): Promise<unknown>;
    getUrl(path: string, params?: Record<string, string | number>): string;
    getImageUrl(id: string, params: { type: string; maxWidth: number; quality: number }): string;
    serverId(): string;
    setRequestHeaders(request: Record<string, string>): void;
};
