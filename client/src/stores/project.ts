import { create } from 'zustand';
import type { DeviceStatus, ProjectInfo, RecipeConfig, TagInfo, TreeItem } from '@shared/types.ts';
import { api } from '../lib/api.ts';

interface DocIndex { names: string[]; tree: TreeItem[] }

interface ProjectState {
  loaded: boolean;
  info?: ProjectInfo;
  tree: TreeItem[];
  tags: Map<string, TagInfo>;
  displays: DocIndex;
  scenes: DocIndex;
  recipes: RecipeConfig[];
  devices: Map<string, DeviceStatus>;
  /** Bumped whenever the server reports a configuration change */
  revision: number;
  refresh(): Promise<void>;
  setDevice(s: DeviceStatus): void;
  setDevices(list: DeviceStatus[]): void;
}

export const useProject = create<ProjectState>((set, get) => ({
  loaded: false,
  tree: [],
  tags: new Map(),
  displays: { names: [], tree: [] },
  scenes: { names: [], tree: [] },
  recipes: [],
  devices: new Map(),
  revision: 0,
  async refresh() {
    const [info, tree, tags, displays, scenes, recipes, devices] = await Promise.all([
      api.get<ProjectInfo>('/info'),
      api.get<TreeItem[]>('/tree'),
      api.get<TagInfo[]>('/tags'),
      api.get<DocIndex>('/displays'),
      api.get<DocIndex>('/scenes'),
      api.get<RecipeConfig[]>('/recipes'),
      api.get<DeviceStatus[]>('/devices'),
    ]);
    set({
      loaded: true, info, tree, displays, scenes, recipes,
      tags: new Map(tags.map((t) => [t.path, t])),
      devices: new Map(devices.map((d) => [d.path, d])),
      revision: get().revision + 1,
    });
  },
  setDevice(s) {
    const devices = new Map(get().devices);
    devices.set(s.path, s);
    set({ devices });
  },
  setDevices: (list) => set({ devices: new Map(list.map((d) => [d.path, d])) }),
}));

export const tagInfo = (path: string): TagInfo | undefined => useProject.getState().tags.get(path);
