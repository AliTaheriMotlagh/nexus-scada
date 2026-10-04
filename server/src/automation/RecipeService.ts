import type { RecipeConfig } from '../../../shared/types.ts';
import type { ProjectStore } from '../config/ProjectStore.ts';
import { badRequest, notFound } from '../core/errors.ts';
import type { TagEngine } from '../tags/TagEngine.ts';

/** Recipes: named parameter sets downloaded to (or uploaded from) groups of tags. */
export class RecipeService {
  private readonly tags: TagEngine;
  private readonly store: ProjectStore;
  private recipes: RecipeConfig[] = [];

  constructor(tags: TagEngine, store: ProjectStore) {
    this.tags = tags;
    this.store = store;
  }

  load(recipes: RecipeConfig[] = []): void {
    this.recipes = recipes;
  }

  all(): RecipeConfig[] {
    return this.recipes;
  }

  private get(name: string): RecipeConfig {
    const r = this.recipes.find((x) => x.name === name);
    if (!r) throw notFound(`Recipe "${name}"`);
    return r;
  }

  /** Write every value of a set; all values are validated before anything is written. */
  async download(name: string, set: string): Promise<void> {
    const r = this.get(name);
    const values = r.sets[set];
    if (!values) throw notFound(`Recipe set "${name}/${set}"`);
    for (const path of Object.keys(values)) {
      if (!r.tags.includes(path)) throw badRequest(`${path} is not part of recipe ${name}`);
      if (!this.tags.has(path)) throw notFound(`Tag "${path}"`);
    }
    for (const [path, value] of Object.entries(values)) await this.tags.write(path, value);
  }

  /** Capture the live values of the recipe tags into a (new) set and persist it to project.yaml. */
  upload(name: string, set: string, user: string): RecipeConfig[] {
    const r = this.get(name);
    r.sets[set] = Object.fromEntries(r.tags.map((p) => [p, this.tags.get(p)?.value ?? null]));
    this.store.updateSection('recipes', this.recipes, user);
    return this.recipes;
  }

  deleteSet(name: string, set: string, user: string): void {
    delete this.get(name).sets[set];
    this.store.updateSection('recipes', this.recipes, user);
  }
}
