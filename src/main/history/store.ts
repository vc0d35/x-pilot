import type { Post } from '../../shared/page';
import type { Conversation, LibraryItem, ScheduledTask, TaskSchedule } from '../../shared/sidebar-api';
import type { AgentEvent } from '../../shared/agent';
import { HistoryDb, migrate, type HistoryStats } from './db';
import { LikesStore, toFtsQuery, type HistoryHit, type HistoryQuery } from './likes';
import { LibraryStore } from './library';
import { ConversationsStore, type RetentionPolicy, type RetentionResult } from './conversations';
import { TasksStore } from './tasks';

export { migrate, toFtsQuery };
export type { HistoryStats, HistoryHit, HistoryQuery, RetentionPolicy, RetentionResult };

/**
 * The application's SQLite store: one connection, four domains. The flat methods below are the
 * surface the rest of the app still calls; new code should reach for `store.likes`, `store.library`,
 * `store.conversations` and `store.tasks` instead.
 */
export class AppStore {
  private readonly database: HistoryDb;
  readonly likes: LikesStore;
  readonly library: LibraryStore;
  readonly conversations: ConversationsStore;
  readonly tasks: TasksStore;

  constructor(path: string) {
    this.database = new HistoryDb(path);
    this.likes = new LikesStore(this.database.db);
    this.library = new LibraryStore(this.database.db);
    this.conversations = new ConversationsStore(this.database.db);
    this.tasks = new TasksStore(this.database.db);
  }

  recordLike(post: Post, likedAt?: string): void {
    this.likes.recordLike(post, likedAt);
  }
  recordUnlike(id: string, at?: string): void {
    this.likes.recordUnlike(id, at);
  }
  search(q: HistoryQuery): HistoryHit[] {
    return this.likes.search(q);
  }
  count(): number {
    return this.likes.count();
  }
  clear(): void {
    this.likes.clear();
  }

  addLibraryItem(i: { postId: string | null; url: string; path: string; title: string }): LibraryItem {
    return this.library.add(i);
  }
  hasLibraryPath(path: string): boolean {
    return this.library.hasPath(path);
  }
  listLibrary(limit?: number): LibraryItem[] {
    return this.library.list(limit);
  }

  upsertConversation(c: { threadId: string; kind: 'chat' | 'task'; taskId?: number | null; toolsHash: string | null }): void {
    this.conversations.upsert(c);
  }
  appendEvent(threadId: string, event: AgentEvent): void {
    this.conversations.appendEvent(threadId, event);
  }
  listEvents(threadId: string): AgentEvent[] {
    return this.conversations.listEvents(threadId);
  }
  listConversations(limit?: number): Conversation[] {
    return this.conversations.list(limit);
  }
  pruneEmptyConversations(exceptThreadId: string | null): void {
    this.conversations.pruneEmpty(exceptThreadId);
  }
  getConversation(threadId: string): Conversation | null {
    return this.conversations.get(threadId);
  }
  applyRetention(policy: RetentionPolicy): RetentionResult {
    return this.conversations.applyRetention(policy);
  }

  createTask(t: {
    title: string;
    prompt: string;
    schedule: TaskSchedule;
    threadMode: 'resume' | 'new';
    webSearch?: boolean;
    visibleWindow?: boolean;
    nextRunAt: string | null;
  }): ScheduledTask {
    return this.tasks.create(t);
  }
  updateTask(
    id: number,
    patch: Partial<
      Pick<
        ScheduledTask,
        | 'title'
        | 'prompt'
        | 'schedule'
        | 'threadMode'
        | 'threadId'
        | 'enabled'
        | 'webSearch'
        | 'lastRunAt'
        | 'lastStatus'
        | 'nextRunAt'
        | 'lastSeenPostId'
        | 'visibleWindow'
      >
    >,
  ): void {
    this.tasks.update(id, patch);
  }
  advanceTaskLastSeenPostId(id: number, postId: string): void {
    this.tasks.advanceLastSeenPostId(id, postId);
  }
  deleteTask(id: number): void {
    this.tasks.delete(id);
  }
  getTask(id: number): ScheduledTask | null {
    return this.tasks.get(id);
  }
  listTasks(): ScheduledTask[] {
    return this.tasks.list();
  }
  dueTasks(now: string): ScheduledTask[] {
    return this.tasks.due(now);
  }

  stats(): HistoryStats {
    return this.database.stats();
  }
  close(): void {
    this.database.close();
  }
}
