import { dialog, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { z } from 'zod';
import { IPC } from '../shared/ipc';
import { PageContextSchema, type PageContext } from '../shared/page';
import type { PageConfigStatus } from '../shared/sidebar-api';
import type { ViewsStatus } from '../shared/views';
import { isOpenablePdf } from './library/paths';
import type { AgentEvent } from '../shared/agent';
import type { AgentController } from './agent/controller';
import type { ApprovalBroker } from './approvals';
import type { UserInputBroker } from './user-input';
import type { SettingsStore } from './settings';
import type { PageStyles } from './page-config/styles';
import type { SelectorOverrides } from './page-config/selectors';
import type { AppStore } from './history/store';
import type { TaskManager } from './tasks/manager';
import { SettingsPatchSchema } from '../shared/settings';
import { PROVIDER_KINDS } from '../shared/agent';
import { isSafeExecutable } from './agent/binary';

const ProviderSchema = z.object({ provider: z.enum(PROVIDER_KINDS) });
const ProviderBinaryActionSchema = z.object({ provider: z.enum(PROVIDER_KINDS), action: z.enum(['choose', 'clear']) });
const PageConfigKindSchema = z.object({ kind: z.enum(['styles', 'selectors']) });
import type { BridgeIpc } from './adapter/bridge';

export interface SidebarIpcDeps {
  sidebar: WebContents;
  setSidebarCollapsed: (collapsed: boolean) => void;
  isSidebarCollapsed: () => boolean;
  openLink: (url: string) => void;
  agent: AgentController;
  approvals: ApprovalBroker;
  userInput: UserInputBroker;
  settings: SettingsStore;
  store: AppStore;
  tasks: TaskManager;
  /** Stops the scheduled run in flight, for the banner's Stop button. */
  stopTaskRun: () => void;
  /** The user did something themselves; a run that wants their window waits for them to stop. */
  onUserActivity: () => void;
  styles: PageStyles;
  selectors: SelectorOverrides;
  libraryDir: () => string;
  openPath: (p: string) => Promise<string>;
  /** The custom views: what there is, what is on screen, and where the folder lives. */
  views: {
    status: () => ViewsStatus;
    deactivate: () => void;
    dir: () => string;
    active: () => string | null;
  };
}

const SendSchema = z.object({ text: z.string().min(1), pageContext: PageContextSchema.nullable() });
/** The note is what the user typed on an option that asked for one; capped so it cannot fill a turn. */
const ResolveSchema = z.object({ id: z.string(), decision: z.string(), note: z.string().max(2000).optional() });
/** Answers by question id; null is a skip. The caps keep a wedged renderer from filling the turn. */
const ResolveInputSchema = z.object({
  id: z.string().max(200),
  answers: z.record(z.string().max(200), z.string().max(4000)).nullable(),
});

/**
 * Whether a card the user has to answer should bring the sidebar back out. Collapsed, the sidebar
 * renders no approval cards at all and the window is entirely the X page — or a custom view's
 * canvas, which owns the whole of it. A question nobody can see is a question nobody answers.
 */
export function shouldExpandSidebar(event: AgentEvent, collapsed: boolean): boolean {
  return event.type === 'approval.requested' && collapsed;
}

export function registerSidebarIpc(deps: SidebarIpcDeps): void {
  const {
    sidebar,
    setSidebarCollapsed,
    isSidebarCollapsed,
    openLink,
    tasks,
    agent,
    approvals,
    userInput,
    settings,
    store,
    styles,
    selectors,
    libraryDir,
    openPath,
    stopTaskRun,
    onUserActivity,
    views,
  } = deps;
  const push = (e: AgentEvent) => {
    if (!sidebar.isDestroyed()) sidebar.send(IPC.agentEvent, e);
  };
  let lastStatus: AgentEvent | null = null;
  let lastThread: AgentEvent | null = null;
  agent.onEvent((e) => {
    if (e.type === 'status') lastStatus = e;
    if (e.type === 'thread') lastThread = e;
    push(e);
  });
  approvals.onEvent((e) => {
    if (shouldExpandSidebar(e, isSidebarCollapsed())) setSidebarCollapsed(false);
    push(e);
  });
  userInput.onEvent(push);
  sidebar.on('did-finish-load', () => {
    if (lastThread) push(lastThread);
    if (lastStatus) push(lastStatus);
    // A reloaded sidebar has no idea a view is up; the banner comes back with this.
    push({ type: 'view.active', view: views.active() });
  });

  /** Only the sidebar renderer may drive these channels; the X view shares the same ipcMain. */
  const guarded =
    <A extends unknown[], R>(fn: (event: IpcMainInvokeEvent, ...args: A) => R) =>
    (event: IpcMainInvokeEvent, ...args: A): R => {
      if (event.sender.id !== sidebar.id) throw new Error('unauthorized');
      return fn(event, ...args);
    };

  ipcMain.handle(
    IPC.agentSend,
    guarded(async (_e, raw) => {
      const { text, pageContext } = SendSchema.parse(raw);
      onUserActivity();
      await agent.send(text, pageContext);
    }),
  );
  ipcMain.handle(
    IPC.agentInterrupt,
    guarded(() => agent.interrupt()),
  );
  ipcMain.handle(
    IPC.agentNewThread,
    guarded(() => agent.start({ resume: false })),
  );
  ipcMain.handle(
    IPC.agentReconnect,
    guarded(() => agent.start({ resume: true })),
  );
  ipcMain.handle(
    IPC.agentResolveApproval,
    guarded((_e, raw) => {
      const { id, decision, note } = ResolveSchema.parse(raw);
      approvals.resolve(id, decision, note);
    }),
  );
  ipcMain.handle(
    IPC.agentResolveInput,
    guarded((_e, raw) => {
      const { id, answers } = ResolveInputSchema.parse(raw);
      if (answers) userInput.resolve(id, answers);
      else userInput.cancel(id);
    }),
  );
  ipcMain.handle(
    IPC.agentListModels,
    guarded((_e, raw) => {
      const { provider } = z.object({ provider: z.enum(PROVIDER_KINDS).optional() }).parse(raw ?? {});
      return agent.modelsFor(provider ?? agent.activeProvider());
    }),
  );
  ipcMain.handle(
    IPC.agentSetProvider,
    guarded((_e, raw) => agent.switchProvider(ProviderSchema.parse(raw).provider)),
  );
  ipcMain.handle(
    IPC.agentProbeProvider,
    guarded((_e, raw) => agent.probeProvider(ProviderSchema.parse(raw).provider)),
  );
  ipcMain.handle(
    IPC.settingsGet,
    guarded(() => settings.get()),
  );
  ipcMain.handle(
    IPC.settingsSet,
    guarded((_e, raw) => settings.update(SettingsPatchSchema.parse(raw))),
  );
  settings.onChange((s) => {
    if (!sidebar.isDestroyed()) sidebar.send(IPC.settingsChanged, s);
  });
  ipcMain.handle(
    IPC.linkOpen,
    guarded((_e, raw) => {
      openLink(z.object({ url: z.string().max(2048) }).parse(raw).url);
    }),
  );
  ipcMain.handle(
    IPC.sidebarSetCollapsed,
    guarded((_e, raw) => {
      setSidebarCollapsed(z.object({ collapsed: z.boolean() }).parse(raw).collapsed);
    }),
  );
  ipcMain.handle(
    IPC.historyClear,
    guarded(() => store.clear()),
  );
  ipcMain.handle(
    IPC.historyStats,
    guarded(() => store.stats()),
  );
  ipcMain.handle(
    IPC.conversationsList,
    guarded(() => agent.listConversations()),
  );
  ipcMain.handle(
    IPC.conversationsOpen,
    guarded((_e, raw) => agent.openConversation(z.object({ threadId: z.string() }).parse(raw).threadId)),
  );
  ipcMain.handle(
    IPC.tasksList,
    guarded(() => tasks.list()),
  );
  ipcMain.handle(
    IPC.tasksUpdate,
    guarded((_e, raw) => {
      const { id, enabled } = z.object({ id: z.number().int(), enabled: z.boolean().optional() }).parse(raw);
      return tasks.update(id, { enabled });
    }),
  );
  ipcMain.handle(
    IPC.tasksDelete,
    guarded((_e, raw) => {
      tasks.delete(z.object({ id: z.number().int() }).parse(raw).id);
    }),
  );
  ipcMain.handle(
    IPC.tasksRunNow,
    guarded((_e, raw) => tasks.runNow(z.object({ id: z.number().int() }).parse(raw).id)),
  );
  ipcMain.handle(
    IPC.tasksStopRun,
    guarded(() => stopTaskRun()),
  );
  ipcMain.handle(
    IPC.libraryList,
    guarded(() => store.listLibrary()),
  );
  ipcMain.handle(
    IPC.libraryOpen,
    guarded(async (_e, raw) => {
      const { path } = z.object({ path: z.string() }).parse(raw);
      if (!isOpenablePdf(path, libraryDir(), (p) => store.hasLibraryPath(p))) throw new Error('not a library PDF');
      await openPath(path);
    }),
  );
  // `binPath` is deliberately absent from the settings patch schema: it is only ever written here,
  // after the file has been checked, so a renderer cannot point the app at an arbitrary executable.
  ipcMain.handle(
    IPC.settingsProviderBinary,
    guarded(async (_e, raw) => {
      const { provider, action } = ProviderBinaryActionSchema.parse(raw);
      const bin = provider === 'claude' ? 'claude' : 'codex';
      const store = (binPath: string | null) =>
        settings.update(provider === 'claude' ? { agent: { claude: { binPath } } } : { agent: { codex: { binPath } } });
      if (action === 'clear') {
        store(null);
        return null;
      }
      const r = await dialog.showOpenDialog({ properties: ['openFile'], message: `Choose the ${bin} executable` });
      const path = r.canceled ? null : r.filePaths[0];
      if (!path) return settings.get().agent[provider].binPath;
      if (!isSafeExecutable(path))
        throw new Error('That file is not a safe executable: it must be a regular file you or root own that nobody else can write');
      store(path);
      return path;
    }),
  );
  // The two page-config files differ only in which store they touch, so they share one trio of
  // channels rather than one each: a row added to Settings cannot then be half-wired.
  const pageConfigStatus = (): PageConfigStatus => ({
    styles: { path: styles.path, lastError: styles.lastError },
    selectors: { path: selectors.path, ...selectors.counts(), lastError: selectors.lastError },
  });
  ipcMain.handle(
    IPC.pageConfigStatus,
    guarded(() => pageConfigStatus()),
  );
  ipcMain.handle(
    IPC.pageConfigOpen,
    guarded(async (_e, raw) => {
      const { kind } = PageConfigKindSchema.parse(raw);
      // Reading creates the file if it is not there yet, so the editor never opens on nothing.
      if (kind === 'styles') styles.get();
      else selectors.list();
      const err = await openPath(kind === 'styles' ? styles.path : selectors.path);
      if (err) throw new Error(err);
    }),
  );
  // The user resetting their own file is the user acting: nothing here is confirmed.
  ipcMain.handle(
    IPC.pageConfigReset,
    guarded((_e, raw) => {
      const { kind } = PageConfigKindSchema.parse(raw);
      if (kind === 'styles') styles.reset();
      else selectors.resetAll();
      return pageConfigStatus();
    }),
  );
  ipcMain.handle(
    IPC.viewsStatus,
    guarded(() => views.status()),
  );
  // Back to X from the banner or the Settings row: the user's own decision, so nothing is confirmed.
  ipcMain.handle(
    IPC.viewsDeactivate,
    guarded(() => views.deactivate()),
  );
  // The views folder and nothing else: the path is ours, never one a renderer sent.
  ipcMain.handle(
    IPC.viewsOpenFolder,
    guarded(async () => {
      const err = await openPath(views.dir());
      if (err) throw new Error(err);
    }),
  );
  ipcMain.handle(
    IPC.libraryChooseDir,
    guarded(async () => {
      const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      settings.update({ library: { dir: r.filePaths[0] } });
      return r.filePaths[0];
    }),
  );
}

/**
 * The visible X view's preload says the user just used the page. It carries nothing but the fact,
 * is rate-limited on the preload side, and is only accepted from that one view.
 */
export function registerUserActivity(deps: { ipc: BridgeIpc; xContentsId: number; onActivity: () => void }): void {
  deps.ipc.on(IPC.userActive, (event) => {
    if (event.sender.id !== deps.xContentsId) return;
    deps.onActivity();
  });
}

export function registerFocusRelay(deps: {
  ipc: BridgeIpc;
  xContentsId: number;
  sidebar: WebContents;
  /** A second consumer of the same context: the custom view on screen, through its `page` feed. */
  onContext?: (context: PageContext | null) => void;
}): void {
  let last: PageContext | null = null;
  deps.ipc.on(IPC.focusChanged, (event, payload) => {
    if (event.sender.id !== deps.xContentsId) return;
    const parsed = PageContextSchema.nullable().safeParse(payload);
    if (!parsed.success) return;
    last = parsed.data;
    if (!deps.sidebar.isDestroyed()) deps.sidebar.send(IPC.focusUpdate, parsed.data);
    deps.onContext?.(parsed.data);
  });
  deps.sidebar.on('did-finish-load', () => deps.sidebar.send(IPC.focusUpdate, last));
}
