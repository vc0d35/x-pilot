import { VIEW_ENTRY_FILE, isViewName, type ViewListEntry } from '../../shared/views';

/** What switching a view needs of the store, the canvas and the settings; unit tests feed fakes. */
export interface ViewSwitcherDeps {
  store: {
    list(): { name: string; files: number; hasIndex: boolean }[];
    exists(view: string): boolean;
    hasIndex(view: string): boolean;
    delete(view: string): boolean;
  };
  active(): string | null;
  show(view: string): Promise<string | null>;
  /** Takes the canvas off the screen, so the X page underneath is what the user is looking at again. */
  hide(): void;
  persist(view: string | null): void;
}

export interface ViewSwitcher {
  list(): ViewListEntry[];
  /** Resolves with the new list, so the caller that asked for the change is the one that shows it. */
  activate(view: string): Promise<ViewListEntry[]>;
  deactivate(): ViewListEntry[];
  remove(view: string): ViewListEntry[];
}

/**
 * Showing, leaving and deleting a view as the user does it, from Settings or the View menu. Nothing
 * here raises a card: the user is the one asking, so the view goes on screen and is remembered
 * straight away. `xpilot_activate_view` is the path that previews first, because there the decision
 * is the model's. Both end in the same canvas and the same `views.active`.
 */
export function createViewSwitcher(deps: ViewSwitcherDeps): ViewSwitcher {
  const list = (): ViewListEntry[] => {
    const active = deps.active();
    return deps.store.list().map((v) => ({ name: v.name, files: v.files, hasIndex: v.hasIndex, active: v.name === active }));
  };
  const deactivate = (): ViewListEntry[] => {
    deps.hide();
    deps.persist(null);
    return list();
  };
  const check = (view: string): void => {
    if (!isViewName(view)) throw new Error(`Not a view name: ${view}`);
  };
  return {
    list,
    activate: async (view) => {
      check(view);
      if (!deps.store.exists(view)) throw new Error(`There is no view called ${view}`);
      if (!deps.store.hasIndex(view)) throw new Error(`${view} has no ${VIEW_ENTRY_FILE} to load`);
      const failure = await deps.show(view);
      if (failure) throw new Error(`${view} could not be shown: ${failure}`);
      deps.persist(view);
      return list();
    },
    deactivate,
    remove: (view) => {
      check(view);
      // A view the user is looking at comes off the screen first, rather than the delete being
      // refused: the canvas is never left on files that are not there any more.
      if (deps.active() === view) deactivate();
      deps.store.delete(view);
      return list();
    },
  };
}
