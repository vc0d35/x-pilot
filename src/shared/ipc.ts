export const IPC = {
  // X preload -> main
  adapterRegister: 'adapter:register',
  adapterResult: 'adapter:result',
  historyLiked: 'history:liked',
  historyUnliked: 'history:unliked',
  focusChanged: 'focus:changed',
  // main -> X preload
  adapterCall: 'adapter:call',
  pageConfigUpdate: 'page-config:update',
  pageConfigPreview: 'page-config:preview',
  // X preload -> main, synchronously, before the page renders
  pageConfigGet: 'page-config:get',
  // sidebar <-> main
  agentSend: 'agent:send',
  agentInterrupt: 'agent:interrupt',
  agentNewThread: 'agent:newThread',
  agentReconnect: 'agent:reconnect',
  agentResolveApproval: 'agent:resolveApproval',
  agentResolveInput: 'agent:resolveInput',
  agentEvent: 'agent:event',
  agentListModels: 'agent:listModels',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsChanged: 'settings:changed',
  settingsCodexBinary: 'settings:codexBinary',
  libraryList: 'library:list',
  libraryOpen: 'library:open',
  libraryChooseDir: 'library:chooseDir',
  historyClear: 'history:clear',
  historyStats: 'history:stats',
  focusUpdate: 'focus:update',
  sidebarSetCollapsed: 'sidebar:setCollapsed',
  sidebarCollapsed: 'sidebar:collapsed',
  linkOpen: 'link:open',
  sidebarFocusInput: 'sidebar:focusInput',
  conversationsList: 'conversations:list',
  conversationsOpen: 'conversations:open',
  tasksList: 'tasks:list',
  tasksUpdate: 'tasks:update',
  tasksDelete: 'tasks:delete',
  tasksRunNow: 'tasks:runNow',
  pageConfigStatus: 'page-config:status',
  pageConfigOpen: 'page-config:open',
  pageConfigReset: 'page-config:reset',
} as const;

/**
 * What an X view is given at startup and on every change. Anything restricted to the view the user
 * is looking at is null in the hidden windows, which must see the page as X ships it.
 */
export interface PageConfig {
  styles: string | null;
  /** The user's selector overrides only; the adapter's shipped defaults stand for every other key. */
  selectors: Partial<Record<string, string>>;
}

/**
 * A stylesheet the user is being shown before it is written, layered over the file styles in the
 * visible view alone; `null` takes it back off. It is inserted per document, so a navigation drops
 * it and nothing has to be undone.
 */
export interface PageStylesPreview {
  css: string | null;
}
