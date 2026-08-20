declare module 'http-proxy-agent' {
  export interface HttpProxyAgentOptions {
    uri?: string;
    port?: number;
    protocol?: string;
    [key: string]: any;
  }
  export class HttpProxyAgent {
    constructor(proxy: string | URL, opts?: HttpProxyAgentOptions);
  }
}
