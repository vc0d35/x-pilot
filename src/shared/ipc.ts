export const IPC = {
  // X preload -> main
  adapterRegister: 'adapter:register',
  adapterResult: 'adapter:result',
  historyLiked: 'history:liked',
  historyUnliked: 'history:unliked',
  focusChanged: 'focus:changed',
  userActive: 'user:active',
  // main -> X preload
  adapterCall: 'adapter:call',
  pageConfigUpdate: 'page-config:update',
  pageConfigPreview: 'page-config:preview',
  // X preload -> main, synchronously, before the page renders
  pageConfigGet: 'page-config:get',
  // canvas (a custom view) <-> main
  viewCall: 'view:call',
  viewSubscribe: 'view:subscribe',
  viewUnsubscribe: 'view:unsubscribe',
  viewFeed: 'view:feed',
  viewBack: 'view:back',
  viewError: 'view:error',
  // sidebar <-> main
  agentSend: 'agent:send',
  agentInterrupt: 'agent:interrupt',
  agentNewThread: 'agent:newThread',
  agentReconnect: 'agent:reconnect',
  agentResolveApproval: 'agent:resolveApproval',
  agentResolveInput: 'agent:resolveInput',
  agentEvent: 'agent:event',
  agentListModels: 'agent:listModels',
  agentSetProvider: 'agent:setProvider',
  agentProbeProvider: 'agent:probeProvider',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsChanged: 'settings:changed',
  settingsProviderBinary: 'settings:providerBinary',
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
  conversationEvent: 'conversation:event',
  tasksList: 'tasks:list',
  tasksUpdate: 'tasks:update',
  tasksDelete: 'tasks:delete',
  tasksRunNow: 'tasks:runNow',
  tasksStopRun: 'tasks:stopRun',
  pageConfigStatus: 'page-config:status',
  pageConfigOpen: 'page-config:open',
  pageConfigReset: 'page-config:reset',
  viewsStatus: 'views:status',
  viewsList: 'views:list',
  viewsActivate: 'views:activate',
  viewsDeactivate: 'views:deactivate',
  viewsDelete: 'views:delete',
  viewsOpenFolder: 'views:openFolder',
  /** main -> sidebar: the list changed, because a file was written or a view went on or off screen. */
  viewsChanged: 'views:changed',
} as const;

/**
 * What an X view is given at startup and on every change. Anything restricted to the view the user
 * is looking at is null in the hidden windows, which must see the page as X ships it.
 */
export interface PageConfig {
  /** Which X view this page is; hidden reading windows never get styles. */
  view: 'visible' | 'hidden';
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
