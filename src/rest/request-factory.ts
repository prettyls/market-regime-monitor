export type RestRequestMethod = "GET" | "POST" | "PUT";

export type RestRequestInput = Readonly<{
  path: string;
  method: RestRequestMethod;
  body?: unknown;
}>;

export class RestRequestFactory {
  constructor(
    private readonly baseUrl: string,
    private readonly defaultHeaders: Readonly<Record<string, string>> = { accept: "application/json" }
  ) {}

  create(input: RestRequestInput): Request {
    const url = this.resolveUrl(input.path);
    if (input.method === "GET" && input.body !== undefined) {
      throw new Error("GET requests must not include a request body");
    }
    const hasJsonBody = input.body !== undefined;
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...(hasJsonBody ? { "content-type": "application/json" } : {}),
    };
    const init: RequestInit = {
      method: input.method,
      headers,
      ...(hasJsonBody ? { body: JSON.stringify(input.body) } : {}),
    };
    return new Request(url, init);
  }

  private resolveUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return new URL(normalizedPath, this.baseUrl).toString();
  }
}
