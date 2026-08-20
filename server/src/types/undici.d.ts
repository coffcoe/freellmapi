declare module 'undici' {
  export interface ProxyAgentOptions {
    uri: string;
  }
  export class ProxyAgent {
    constructor(options: ProxyAgentOptions);
  }
}
