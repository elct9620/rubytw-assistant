export interface RequestContext {
  traceId?: string
}

export const nullContext: RequestContext = Object.freeze({})
